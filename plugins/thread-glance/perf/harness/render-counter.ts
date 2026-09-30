// Counts what each React commit rendered, by the attributes the list puts on
// its DOM rather than by component name: a row renders when the component
// that owns its anchor (`data-sidebar-thread-id`) runs, a group header when
// the one that owns `data-sidebar="group-label"` does (named by the group
// around it), the list header likewise for `data-sidebar="list-header"`. It reads commits through the hook
// React DevTools uses, so it must be imported before react-dom: import it
// first in any file that counts.

/** What one stretch of commits rendered; each counts at most once per commit. */
export interface RenderCount {
  commits: number;
  /** Commits that rendered a row, a group header or the list header. */
  listCommits: number;
  /** Row renders, summed over commits. */
  rows: number;
  /** Renders per thread id. */
  rowIds: Map<string, number>;
  /** Renders per group id. */
  groupHeaders: Map<string, number>;
  listHeader: number;
  /** Time this counter spent walking commits, to take off any timing around them. */
  overheadMs: number;
}

interface Fiber {
  tag: number;
  type: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: Record<string, unknown> | null;
  memoizedState: unknown;
  stateNode: unknown;
}

interface FiberRoot {
  current: Fiber;
}

const HOST_COMPONENT = 5;
const COMPOSITE_TAGS = new Set([0, 1, 11, 14, 15]);
const PERFORMED_WORK = 1;

let counting: RenderCount | null = null;
const roots = new Set<FiberRoot>();
let commitListeners: (() => void)[] = [];

function emptyCount(): RenderCount {
  return { commits: 0, listCommits: 0, rows: 0, rowIds: new Map(), groupHeaders: new Map(), listHeader: 0, overheadMs: 0 };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** What a component's output holds: the thread anchors, group headers and list headers under it. */
interface Marks {
  anchor: string | null;
  anchors: number;
  label: Fiber | null;
  labels: number;
  lists: number;
}

/** Scans a subtree for marks, stopping once it holds more than one. */
function marksUnder(fiber: Fiber): Marks {
  const marks: Marks = { anchor: null, anchors: 0, label: null, labels: 0, lists: 0 };
  const total = () => marks.anchors + marks.labels + marks.lists;
  const visit = (node: Fiber | null): void => {
    for (; node !== null && total() < 2; node = node.sibling) {
      if (node.tag === HOST_COMPONENT && node.memoizedProps !== null) {
        const props = node.memoizedProps;
        const threadId = props["data-sidebar-thread-id"];
        if (typeof threadId === "string") {
          marks.anchor = threadId;
          marks.anchors += 1;
        } else if (props["data-sidebar"] === "group-label") {
          marks.label = node;
          marks.labels += 1;
        } else if (props["data-sidebar"] === "list-header") marks.lists += 1;
      }
      visit(node.child);
    }
  };
  visit(fiber.child);
  return marks;
}

/**
 * Whether a component ran in this commit: it mounted, its output was used
 * (React's PerformedWork flag), or it ran and React discarded its output
 * because nothing changed, which still leaves it a new list of hooks.
 */
function ran(fiber: Fiber, fresh: boolean): boolean {
  if (fresh) return true;
  if ((fiber.flags & PERFORMED_WORK) !== 0) return true;
  return fiber.memoizedState !== null && fiber.memoizedState !== fiber.alternate!.memoizedState;
}

interface CommitMarks {
  rows: Set<string>;
  labels: Set<string>;
  list: boolean;
}

/**
 * Walks the committed tree the way React DevTools does: a subtree whose child
 * pointer is unchanged did not render, and a fiber with no alternate mounted.
 * The outermost component around exactly one mark owns it: a row's component
 * for a thread anchor, a group header's or the list header's likewise, and
 * the mark rendered when that component ran. Components inside it that run on
 * their own (a menu's or a tooltip's internals) do not render the row. A
 * wrapper around a single row (a group of one) stands in for that row's own.
 */
function walk(fiber: Fiber | null, mounted: boolean, found: CommitMarks): void {
  for (let node = fiber; node !== null; node = node.sibling) {
    const previous = node.alternate;
    const fresh = mounted || previous === null;
    if (COMPOSITE_TAGS.has(node.tag)) {
      const marks = marksUnder(node);
      const total = marks.anchors + marks.labels + marks.lists;
      if (total === 0) continue;
      if (total === 1) {
        if (!ran(node, fresh)) continue;
        if (marks.anchor !== null) found.rows.add(marks.anchor);
        else if (marks.label !== null) found.labels.add(groupOf(marks.label));
        else found.list = true;
        continue;
      }
    }
    if (fresh) walk(node.child, true, found);
    else if (node.child !== previous!.child) walk(node.child, false, found);
  }
}

function groupOf(label: Fiber): string {
  const node = label.stateNode as Element | null;
  return node?.closest?.("[data-sidebar-visibility-group]")?.getAttribute("data-sidebar-visibility-group") ?? "?";
}

function onCommit(root: FiberRoot): void {
  roots.add(root);
  if (counting !== null) {
    const started = performance.now();
    counting.commits += 1;
    const current = root.current;
    const found: CommitMarks = { rows: new Set(), labels: new Set(), list: false };
    walk(current.child, current.alternate === null, found);
    for (const id of found.rows) bump(counting.rowIds, id);
    for (const id of found.labels) bump(counting.groupHeaders, id);
    counting.rows += found.rows.size;
    if (found.rows.size > 0 || found.labels.size > 0 || found.list) counting.listCommits += 1;
    if (found.list) counting.listHeader += 1;
    counting.overheadMs += performance.now() - started;
  }
  const listeners = commitListeners;
  commitListeners = [];
  for (const listener of listeners) listener();
}

interface DevToolsHook {
  supportsFiber: boolean;
  isDisabled?: boolean;
  renderers: Map<number, unknown>;
  inject(renderer: unknown): number;
  onCommitFiberRoot(id: number, root: FiberRoot, ...rest: unknown[]): void;
  onCommitFiberUnmount(...args: unknown[]): void;
  onPostCommitFiberRoot?(...args: unknown[]): void;
  checkDCE?(): void;
}

const global = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook };
const existing = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (existing === undefined) {
  global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot: (_id, root) => onCommit(root),
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
} else {
  // A real DevTools hook keeps working; commits are also counted here.
  const forward = existing.onCommitFiberRoot.bind(existing);
  existing.onCommitFiberRoot = (id, root, ...rest) => {
    forward(id, root, ...rest);
    onCommit(root);
  };
}

/** Whether react-dom reached this hook: false when it loaded first. */
export function counterAttached(): boolean {
  return (global.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers.size ?? 0) > 0 || roots.size > 0;
}

/** Counts every commit from now until `stopCounting`. */
export function startCounting(): void {
  counting = emptyCount();
}

export function stopCounting(): RenderCount {
  const count = counting ?? emptyCount();
  counting = null;
  return count;
}

/** Resolves after the next commit of any root. */
export function nextCommit(): Promise<void> {
  return new Promise((resolve) => commitListeners.push(resolve));
}

/**
 * Fibers in every mounted root whose component carries one of `names` as its
 * display name: a count of third-party primitives, which name themselves.
 */
export function countComponents(names: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  const visit = (fiber: Fiber | null): void => {
    for (let node = fiber; node !== null; node = node.sibling) {
      const type = node.type as { displayName?: string; render?: { displayName?: string } } | null;
      const name = typeof type === "function" || typeof type === "object" ? (type?.displayName ?? type?.render?.displayName) : undefined;
      if (name !== undefined && name in counts) counts[name]! += 1;
      visit(node.child);
    }
  };
  for (const root of roots) visit(root.current.child);
  return counts;
}

/** Forgets roots that have unmounted, so `countComponents` sees only live ones. */
export function forgetRoots(): void {
  roots.clear();
}
