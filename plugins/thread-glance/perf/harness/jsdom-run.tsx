// The jsdom run: mounts the list over a generated list through the fake host
// and reports, per event, what rendered (rows, group headers, the list
// header), the commits and the plugin's JavaScript time. Counts come from
// render-counter, which the calling file imports before anything else. What
// a row or header draws is read off the DOM before and after each event, so
// a render that changed nothing drawn is told apart from one that did.
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { CHANNELS } from "@/shared/contract";
import type { GeneratedList } from "@/features/thread-list/testing/fixtures";
import { countComponents, startCounting, stopCounting, type RenderCount } from "./render-counter";
import { createFakeHost, loadWithFakeHost, mountList, serverState } from "./fake-host";
import { markAllReadConfirm } from "./list-screen";

/** What one event rendered. */
export interface EventFigure {
  /** Row renders, summed over the event's commits. */
  rows: number;
  /** The rows that rendered, when few enough to list. */
  rowIds: string[] | null;
  /** Distinct rows that rendered. */
  distinctRows: number;
  /** Rows that rendered with nothing they draw changed, the event's own thread aside. */
  extraRows: number;
  /** Group header renders, summed over commits. */
  groupHeaders: number;
  listHeader: number;
  /** Group headers and the list header that rendered with nothing they draw changed. */
  extraHeaders: number;
  commits: number;
  /** The plugin's JavaScript time, less the counter's own. */
  jsMs: number;
  /** The thread the event was about, when it had one. */
  threadId: string | null;
}

export interface MinuteTickFigure {
  rendered: number;
  /** Rows whose drawn time or label changes with the minute; -1 when not checked. */
  expected: number;
  /** Rendered with nothing of theirs changed. */
  extra: number;
  /** Changed without rendering. */
  missed: number;
  /** Rows rendered by a tick while the window is hidden. */
  hidden: number;
}

export interface DragFigure {
  moves: number;
  /** Moves that changed the drop feedback drawn, and the most rows one of them rendered. */
  targetChanges: number;
  maxRowsOnChange: number;
  /** Rows rendered by moves that left the feedback as it was. */
  rowsOnUnchanged: number;
  /** Renders of rows other than the dragged one, over every move. */
  otherRows: number;
  commits: number;
  jsMs: number;
}

export interface JsdomFigures {
  threads: number;
  mountedRows: number;
  groups: number;
  events: Record<string, EventFigure>;
  drag: DragFigure;
  minuteTick: MinuteTickFigure;
  /** Radix menu, context menu, hover card and popover roots mounted at rest. */
  menuPrimitives: Record<string, number>;
}

export interface MarkAllReadFigure {
  counted: number;
  /** Counted threads still drawn unread once the click's own commit is drawn. */
  unreadAfterClick: number;
  /** List commits from the click to the last `setRead` answer. */
  commits: number;
  jsMs: number;
}

/**
 * Radix's menu, context menu, hover card and popover roots, by the provider
 * each mounts (Radix names them `<Root>Provider`).
 */
export const MENU_PRIMITIVES = ["DropdownMenuProvider", "ContextMenuProvider", "HoverCardProvider", "PopoverProvider"] as const;

export interface JsdomOptions {
  /** Timed samples per event; counts come from the first. */
  samples?: number;
}

function ensureObservers(): void {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Lets loads and effects queued by the last change land. */
export async function settle(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function anchors(root: ParentNode = document): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("[data-sidebar-thread-id]")];
}

/** What each row draws, by thread id: the row around its anchor, as markup. */
function drawnRows(root: ParentNode): Map<string, string> {
  return new Map(anchors(root).map((anchor) => [anchor.dataset.sidebarThreadId!, anchor.parentElement?.outerHTML ?? anchor.outerHTML]));
}

/** What each group header and the list header draw. */
function drawnHeaders(root: ParentNode): Map<string, string> {
  const headers = new Map<string, string>();
  for (const label of root.querySelectorAll('[data-sidebar="group-label"]')) {
    const group = label.closest("[data-sidebar-visibility-group]")?.getAttribute("data-sidebar-visibility-group") ?? "?";
    headers.set(group, label.outerHTML);
  }
  const list = root.querySelector('[data-sidebar="list-header"]');
  if (list !== null) headers.set("list-header", list.outerHTML);
  return headers;
}

/** What each row reads as: its anchor's label and its text, which two mounts draw alike. */
function readRows(root: ParentNode): Map<string, string> {
  return new Map(
    anchors(root).map((anchor) => [
      anchor.dataset.sidebarThreadId!,
      `${anchor.getAttribute("aria-label") ?? ""}|${anchor.parentElement?.textContent ?? ""}`,
    ]),
  );
}

/** The drop feedback drawn: bb's nest and reorder attributes, by row. */
function drawnFeedback(root: ParentNode): string {
  return [...root.querySelectorAll("[data-sidebar-nest-target],[data-sidebar-reorder-placement]")]
    .map((node) => `${node.querySelector("[data-sidebar-thread-id]")?.getAttribute("data-sidebar-thread-id")}:${node.getAttribute("data-sidebar-nest-target")}:${node.getAttribute("data-sidebar-reorder-placement")}`)
    .join(" ");
}

/**
 * Runs one event and counts what it rendered. `steps` runs it outside act,
 * for an event that is a series of acts: nested acts batch into one commit.
 */
export async function measure(
  run: () => void | Promise<void>,
  { steps = false }: { steps?: boolean } = {},
): Promise<{ count: RenderCount; wallMs: number }> {
  startCounting();
  const started = performance.now();
  if (steps) await run();
  else
    await act(async () => {
      await run();
    });
  await settle(2);
  const wallMs = performance.now() - started;
  return { count: stopCounting(), wallMs };
}

/** Measures an event and compares what rows and headers draw before and after it. */
async function measureEvent(container: HTMLElement, threadId: string | null, run: () => void | Promise<void>): Promise<EventFigure> {
  const rowsBefore = drawnRows(container);
  const headersBefore = drawnHeaders(container);
  const { count, wallMs } = await measure(run);
  const rowsAfter = drawnRows(container);
  const headersAfter = drawnHeaders(container);
  const ids = [...count.rowIds.keys()];
  const unchanged = (before: Map<string, string>, after: Map<string, string>, id: string) =>
    before.has(id) && before.get(id) === after.get(id);
  const headerIds = [...count.groupHeaders.keys(), ...(count.listHeader > 0 ? ["list-header"] : [])];
  return {
    rows: count.rows,
    rowIds: ids.length <= 20 ? ids : null,
    distinctRows: ids.length,
    extraRows: ids.filter((id) => id !== threadId && unchanged(rowsBefore, rowsAfter, id)).length,
    groupHeaders: [...count.groupHeaders.values()].reduce((sum, value) => sum + value, 0),
    listHeader: count.listHeader,
    extraHeaders: headerIds.filter((id) => unchanged(headersBefore, headersAfter, id)).length,
    commits: count.commits,
    jsMs: Number(Math.max(0, wallMs - count.overheadMs).toFixed(2)),
    threadId,
  };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A mounted window over a generated list, with the clock faked from `list.now`. */
export async function openList(list: GeneratedList, options: { freshActions?: boolean; setReadMs?: number } = {}) {
  ensureObservers();
  vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
  vi.setSystemTime(list.now);
  const host = createFakeHost({
    threads: list.threads,
    projects: list.projects,
    freshActions: options.freshActions ?? true,
    setReadMs: options.setReadMs,
  });
  const app = await loadWithFakeHost();
  const slot = mountList(app, serverState());
  await settle(5);
  return { host, app, slot };
}

/** Every event of the jsdom run over one list. */
export async function runJsdom(list: GeneratedList, options: JsdomOptions = {}): Promise<JsdomFigures> {
  const samples = options.samples ?? 1;
  const { host, app, slot } = await openList(list);
  const container = slot.container;
  const mounted = anchors(container);
  const onScreen = mounted[0]!.dataset.sidebarThreadId!;
  const other = mounted[1]!.dataset.sidebarThreadId!;
  const shown = new Set(mounted.map((anchor) => anchor.dataset.sidebarThreadId!));
  // Off screen in jsdom, which lays nothing out: a child thread behind its
  // closed children chip, which has no row mounted.
  const offScreen = list.threads.find((thread) => !shown.has(thread.id))?.id ?? null;
  // A note draws on an unread row, so the signal has something to change.
  const noted = mounted.find((anchor) => list.unreadIds.includes(anchor.dataset.sidebarThreadId!))?.dataset.sidebarThreadId ?? onScreen;
  // The last root row of the first group, which a new turn moves to its top.
  const firstGroup = container.querySelector("[data-sidebar-visibility-group]")!;
  const lowest = anchors(firstGroup)
    .map((anchor) => anchor.dataset.sidebarThreadId!)
    .filter((id) => list.threads.find((thread) => thread.id === id)?.parentThreadId === null)
    .at(-1)!;
  const thread = (id: string) => host.state().threads.find((candidate) => candidate.id === id)!;
  let serial = 0;
  const turn = (id: string) => {
    serial += 1;
    const working = thread(id).status !== "active";
    host.updateThread(id, {
      status: working ? "active" : "idle",
      runtimeStatus: working ? "active" : "idle",
      updatedAt: Math.max(thread(id).updatedAt, Date.now() - 1_000) + serial,
    });
  };

  const events: Record<string, { threadId: string | null; run: (index: number) => void | Promise<void> }> = {
    "update on screen": { threadId: onScreen, run: () => turn(onScreen) },
    ...(offScreen === null ? {} : { "update off screen": { threadId: offScreen, run: () => turn(offScreen) } }),
    "new thread": {
      threadId: null,
      run: (index) => {
        const newest: PluginSidebarThread = {
          ...thread(onScreen),
          id: `new${index}`,
          title: `New ${index}`,
          displayTitle: `New ${index}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          latestAttentionAt: Date.now(),
          lastReadAt: Date.now(),
          isUnread: false,
          status: "active",
          runtimeStatus: "active",
        };
        host.update({ threads: [newest, ...host.state().threads] });
      },
    },
    "thread moves": {
      threadId: lowest,
      run: () =>
        host.updateThread(lowest, {
          status: "active",
          runtimeStatus: "active",
          createdAt: Date.now(),
          updatedAt: Date.now() + ++serial,
          latestAttentionAt: Date.now(),
          lastReadAt: Date.now(),
        }),
    },
    "stamp signal": {
      threadId: onScreen,
      run: (index) =>
        slot.emitRealtime(CHANNELS.stamps, { kind: "startedAt", threadIds: [onScreen], value: Date.now() - (index + 1) * 60_000 }),
    },
    "note signal": {
      threadId: noted,
      run: (index) =>
        slot.emitRealtime(CHANNELS.notes, {
          threadId: noted,
          notes: { done: { kind: "done", text: `Done ${index}`, at: Date.now() } },
        }),
    },
    "read change": {
      threadId: onScreen,
      run: () => {
        const unread = !thread(onScreen).isUnread;
        const at = Date.now() + ++serial;
        host.updateThread(onScreen, unread ? { isUnread: true, latestAttentionAt: at } : { isUnread: false, lastReadAt: at });
      },
    },
    "split layout": {
      threadId: onScreen,
      run: (index) =>
        host.update({
          splitLayout: {
            panes: [
              { paneId: "left", rect: { x: 0, y: 0, width: 0.5, height: 1 }, threadId: onScreen, isFocused: index % 2 === 0 },
              { paneId: "right", rect: { x: 0.5, y: 0, width: 0.5, height: 1 }, threadId: other, isFocused: index % 2 === 1 },
            ],
          },
        }),
    },
    "draft change": {
      threadId: onScreen,
      run: () => {
        const draftIds = new Set(host.state().draftIds);
        if (draftIds.has(onScreen)) draftIds.delete(onScreen);
        else draftIds.add(onScreen);
        host.update({ draftIds });
      },
    },
    "row status change": {
      threadId: onScreen,
      run: (index) =>
        host.update({ rowStatuses: new Map([[onScreen, { icon: "Fire", label: `Status ${index}`, tone: "running" as const }]]) }),
    },
    "new actions": { threadId: null, run: () => host.update({}) },
    "new onNavigate": { threadId: null, run: () => host.updateProps() },
    "equal providers": {
      threadId: null,
      run: () =>
        host.update({
          providers: host.state().providers.map((provider) => ({ ...provider })),
          sections: host.state().sections.map((section) => ({ ...section })),
          environmentProviders: host.state().environmentProviders.map((provider) => ({ ...provider })),
        }),
    },
  };

  const figures: Record<string, EventFigure> = {};
  for (const [name, event] of Object.entries(events)) {
    let first: EventFigure | null = null;
    const times: number[] = [];
    for (let index = 0; index < samples; index += 1) {
      const figure = await measureEvent(container, event.threadId, () => event.run(index));
      first ??= figure;
      times.push(figure.jsMs);
    }
    figures[name] = { ...first!, jsMs: Number(median(times).toFixed(2)) };
  }
  const drag = await dragMoves(container, onScreen);
  const menuPrimitives = countComponents(MENU_PRIMITIVES);
  const minuteTick = await tick();
  const result: JsdomFigures = {
    threads: list.threads.length,
    mountedRows: mounted.length,
    groups: container.querySelectorAll('[data-sidebar="group-label"]').length,
    events: figures,
    drag,
    minuteTick,
    menuPrimitives,
  };
  slot.unmount();
  vi.useRealTimers();
  return result;

  async function tick(): Promise<MinuteTickFigure> {
    const before = readRows(container);
    const { count } = await measure(() => {
      vi.advanceTimersByTime(60_000);
    });
    setHidden(true);
    const { count: hiddenCount } = await measure(() => {
      vi.advanceTimersByTime(60_000);
    });
    setHidden(false);
    // The rows whose time or label a minute changes, read off a list mounted
    // fresh at the later clock rather than off rows that may not redraw.
    vi.setSystemTime(Date.now() - 60_000);
    const fresh = mountList(app, serverState());
    await settle(5);
    const later = readRows(fresh.container);
    fresh.unmount();
    const rendered = new Set(count.rowIds.keys());
    const expected = new Set([...before].filter(([id, markup]) => later.has(id) && later.get(id) !== markup).map(([id]) => id));
    return {
      rendered: rendered.size,
      expected: expected.size,
      extra: [...rendered].filter((id) => !expected.has(id)).length,
      missed: [...expected].filter((id) => !rendered.has(id)).length,
      hidden: hiddenCount.rows,
    };
  }
}

const ROW_PX = 28;

/**
 * Lays rows out for dnd-kit, which jsdom gives no layout: each element sits
 * where the anchors inside it would, one row height each in list order.
 */
function fakeLayout(container: HTMLElement): () => void {
  const order = new Map(anchors(container).map((anchor, index) => [anchor as Element, index]));
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const own = this.hasAttribute("data-sidebar-thread-id") ? [this] : [...this.querySelectorAll("[data-sidebar-thread-id]")];
    const indexes = own.map((anchor) => order.get(anchor)).filter((index) => index !== undefined);
    if (indexes.length === 0) return original.call(this);
    const top = Math.min(...indexes) * ROW_PX;
    const bottom = (Math.max(...indexes) + 1) * ROW_PX;
    return new DOMRect(0, top, 240, bottom - top);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** 50 mouse moves down the rows while dragging the first: the target changes about every other move. */
async function dragMoves(container: HTMLElement, threadId: string): Promise<DragFigure> {
  const restore = fakeLayout(container);
  const row = container.querySelector<HTMLElement>(`[data-sidebar-thread-id="${threadId}"]`)!.parentElement!;
  const at = (y: number) => ({ clientX: 10, clientY: y, bubbles: true, button: 0 });
  const figure: DragFigure = { moves: 50, targetChanges: 0, maxRowsOnChange: 0, rowsOnUnchanged: 0, otherRows: 0, commits: 0, jsMs: 0 };
  try {
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", at(ROW_PX / 2)));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousemove", at(ROW_PX / 2 + 8)));
    });
    await settle(1);
    for (let index = 1; index <= figure.moves; index += 1) {
      const feedback = drawnFeedback(container);
      const { count, wallMs } = await measure(
        async () => {
          await act(async () => {
            document.dispatchEvent(new MouseEvent("mousemove", at(ROW_PX + index * (ROW_PX / 2))));
          });
        },
        { steps: true },
      );
      const changed = drawnFeedback(container) !== feedback;
      if (changed) {
        figure.targetChanges += 1;
        figure.maxRowsOnChange = Math.max(figure.maxRowsOnChange, count.rows);
      } else figure.rowsOnUnchanged += count.rows;
      figure.otherRows += count.rows - (count.rowIds.get(threadId) ?? 0);
      figure.commits += count.commits;
      figure.jsMs += Math.max(0, wallMs - count.overheadMs);
    }
    figure.jsMs = Number(figure.jsMs.toFixed(2));
    return figure;
  } finally {
    // Cancel, then release and click as a mouse would: dnd-kit swallows the
    // click that follows a drag, which would otherwise be the next event's.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    await settle(2);
    restore();
  }
}

/** A row whose label says it is unread (not "unread below", which is its children). */
const UNREAD = /\bunread\b(?! below)/i;

/** Mark all read on the MAR list, with each `setRead` answering after 50 ms. */
export async function runMarkAllRead(list: GeneratedList): Promise<MarkAllReadFigure> {
  const { host, slot } = await openList(list, { setReadMs: 50 });
  const counted = new Set(list.unreadIds);
  await act(async () => {
    slot.getByRole("button", { name: "Mark all read" }).click();
  });
  await settle(2);
  const confirm = markAllReadConfirm(slot);
  startCounting();
  const started = performance.now();
  await act(async () => {
    confirm.click();
  });
  const unreadAfterClick = anchors(slot.container).filter(
    (anchor) => counted.has(anchor.dataset.sidebarThreadId!) && UNREAD.test(anchor.getAttribute("aria-label") ?? ""),
  ).length;
  await act(async () => {
    await host.setReadSettled();
  });
  await settle(3);
  const wallMs = performance.now() - started;
  const count = stopCounting();
  slot.unmount();
  vi.useRealTimers();
  return {
    counted: counted.size,
    unreadAfterClick,
    commits: count.commits,
    jsMs: Number(Math.max(0, wallMs - count.overheadMs).toFixed(2)),
  };
}
