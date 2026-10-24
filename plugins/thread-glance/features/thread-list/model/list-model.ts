// The list model: bb's threads, the server's lifecycle rows and the device's
// settings turned into shelves of items. One pure function builds it; the
// store runs it when an input changes and keeps whatever did not change.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  nextWakeAt,
  shelfOf,
  shouldClearForPin,
  wakeReason,
  type LifecycleRow,
  type Shelf,
  type WakeReason,
} from "@/shared/lifecycle";
import { isWorking } from "@/shared/busy";
import { sortByManualOrder } from "@/shared/manual-order";
import type { Settings } from "@/shared/settings";
import type { TreeSignals } from "@/shared/lifecycle";
import { isShelfCollapsed, type DeviceState } from "../storage/device-state";
import type { Scope } from "./scope";
import { buildForest, isFailed, urgencyOfRoots, type ChildrenInfo, type Forest, type Urgency } from "./forest";
import {
  canReorderActive,
  comparePinned,
  flattenEntries,
  groupByProject,
  memberThreads,
  sortActive,
  sortParked,
  sortSettled,
  sortSnoozed,
  type ActiveEntry,
  type GroupMember,
} from "./ordering";

/** Settled shows this many rows, then "Load N more" in pages. */
export const SETTLED_FIRST_PAGE = 10;
export const SETTLED_PAGE = 25;

/** How a top-level row is drawn. */
export type CardKind = "full" | "folded" | "slim";

/** A thread as its row draws it. Rows subscribe to their own by thread id. */
export interface RowView {
  id: string;
  thread: PluginSidebarThread;
  /** The shelf of a row of its own; null for a thread listed under its parent. */
  shelf: Shelf | null;
  card: CardKind;
  lifecycle: LifecycleRow | null;
  /** Why a snoozed thread woke; null while it sleeps and for any other thread. */
  woke: WakeReason | null;
  /** What the thread's tree says: working somewhere below, a question pending somewhere. */
  tree: TreeSignals;
  /** The thread sits in a Project-mode group, whose header names the project. */
  grouped: boolean;
  /** The thread sits in a worktree group inside its project's group, drawn one step in. */
  inWorktree: boolean;
  focused: boolean;
  /** Another split pane shows the thread. */
  openElsewhere: boolean;
  hasDraft: boolean;
  children: ChildrenInfo | null;
  /** The children drawn under the card now, in order: all while the list is open, else the path to the open thread and the ones needing attention. */
  shownChildIds: readonly string[];
  /** The child list is open on this device. */
  expanded: boolean;
}

/**
 * An entry of a shelf's list, as the list draws it. The `headers` of a row,
 * group or worktree group are the keys of the shelf, group and worktree headers
 * it sits under, outermost first.
 */
export type ListItem =
  | { kind: "shelf"; key: string; shelf: Shelf; count: number; collapsed: boolean; spinning: boolean }
  | { kind: "group"; key: string; projectId: string; count: number; collapsed: boolean; headers: readonly string[] }
  | {
      kind: "worktree";
      key: string;
      projectId: string;
      environmentId: string;
      /** The branch the group is named by. */
      branch: string;
      count: number;
      collapsed: boolean;
      /** While collapsed, the most urgent thing in its threads and below them; null otherwise. */
      urgency: Urgency | null;
      headers: readonly string[];
    }
  | { kind: "row"; key: string; threadId: string; shelf: Shelf; headers: readonly string[] }
  | { kind: "more"; key: string; remaining: number; next: number };

export type Scene = "all-clear" | "working";

/** One draggable unit: a thread, or a project or worktree group moved by its header. */
export interface ReorderUnit {
  key: string;
  /** The threads the unit holds, in order. */
  ids: readonly string[];
  title: string;
}

/** A list of units that reorder among themselves. */
export interface ReorderList {
  key: string;
  /** What announcements call the list: "Active" or "Pinned". */
  label: "Active" | "Pinned";
  units: readonly ReorderUnit[];
}

export interface ListModel {
  rows: ReadonlyMap<string, RowView>;
  /** Pinned and Active. */
  upper: readonly ListItem[];
  /** Working, Inactive, Snoozed, Parked and Settled. */
  lower: readonly ListItem[];
  scene: Scene | null;
  /** The threads of each shelf, in order, collapsed or not. */
  shelves: Readonly<Record<Shelf, readonly string[]>>;
  /** The lists a drag or Alt+Arrow reorders, by list key. */
  reorderLists: ReadonlyMap<string, ReorderList>;
  /** Each row's list and unit: a thread id, a project group's `group:<projectId>` key or a worktree group's `worktree:<environmentId>` key. */
  reorderOf: ReadonlyMap<string, { listKey: string; unitKey: string }>;
  /** Pinned threads with a lifecycle row, whose rows the server is asked to clear. */
  pinnedWithRow: readonly string[];
  /** The root row the open thread is listed in or under, which a collapsed shelf keeps drawn. */
  openRootId: string | null;
  /** When the next snooze ends, for the clock. */
  nextDeadline: number | null;
}

/** A drag preview: a list's units in the order the pointer has put them. */
export interface DragPreview {
  listKey: string;
  unitKeys: readonly string[];
}

export interface ModelInputs {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  lifecycle: Readonly<Record<string, LifecycleRow>>;
  settings: Settings;
  order: readonly string[];
  device: DeviceState;
  /** The project scope; empty for All projects. */
  scope: Scope;
  activeThreadId: string | null;
  draftIds: ReadonlySet<string>;
  /** Threads other split panes show. */
  openElsewhereIds: ReadonlySet<string>;
  now: number;
  compact: boolean;
  /** Settled rows shown. */
  settledShown: number;
  /** A row being renamed keeps the shelf it was on. */
  frozenShelves: ReadonlyMap<string, Shelf>;
  /** Pinned ids in the order a reorder put them, until bb's list shows it. */
  pinnedOverride: readonly string[] | null;
  drag: DragPreview | null;
}

const EMPTY_SHELVES: Record<Shelf, string[]> = {
  pinned: [],
  active: [],
  working: [],
  inactive: [],
  snoozed: [],
  parked: [],
  settled: [],
};

const UPPER: readonly Shelf[] = ["pinned", "active"];
const LOWER: readonly Shelf[] = ["working", "inactive", "snoozed", "parked", "settled"];

/** Whether the shelf is drawn at all: Working only while its setting is on. */
function shelfVisible(shelf: Shelf, settings: Settings): boolean {
  return shelf !== "working" || settings.workingShelf;
}

/** The card a top-level row is drawn as. */
export function cardKindOf(shelf: Shelf, thread: PluginSidebarThread, tree: TreeSignals, compactWorking: boolean): CardKind {
  if (shelf === "snoozed" || shelf === "parked" || shelf === "settled") return "slim";
  if (shelf === "working") return "folded";
  const working = isWorking(thread) && !thread.hasPendingInteraction && !isFailed(thread) && !tree.needsYou;
  return compactWorking && working ? "folded" : "full";
}

/** Whether a child shows in a closed child list for having a status. */
export function childHasStatus(thread: PluginSidebarThread): boolean {
  return thread.indicator !== "none" || thread.hasPendingInteraction || thread.queuedWork !== "none";
}

/** `ids` reordered to follow `keys`, the ones `keys` does not name staying last in their order. */
function followKeys<T extends { key: string }>(units: readonly T[], keys: readonly string[]): T[] {
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const ordered = keys.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  const named = new Set(ordered.map((unit) => unit.key));
  return [...ordered, ...units.filter((unit) => !named.has(unit.key))];
}

export function buildModel(inputs: ModelInputs): ListModel {
  const { settings, device, now, lifecycle, activeThreadId } = inputs;
  const forest = buildForest(inputs.threads, inputs.scope, settings);
  const rowOf = (id: string): LifecycleRow | null => lifecycle[id] ?? null;

  // Which shelf each root is on.
  const shelfById = new Map<string, Shelf>();
  const buckets: Record<Shelf, PluginSidebarThread[]> = {
    pinned: [],
    active: [],
    working: [],
    inactive: [],
    snoozed: [],
    parked: [],
    settled: [],
  };
  for (const root of forest.roots) {
    const tree = forest.treeOf.get(root.id)!;
    const shelf =
      inputs.frozenShelves.get(root.id) ??
      shelfOf(rowOf(root.id), root, {
        now,
        workingShelf: settings.workingShelf,
        inactiveShelf: settings.inactiveShelf,
        hoursBeforeInactive: settings.hoursBeforeInactive,
        tree,
      });
    shelfById.set(root.id, shelf);
    buckets[shelf].push(root);
  }

  // Order within each shelf.
  let pinned = buckets.pinned.slice().sort(comparePinned);
  if (inputs.pinnedOverride !== null) {
    const place = new Map(inputs.pinnedOverride.map((id, index) => [id, index]));
    if (pinned.every((thread) => place.has(thread.id))) pinned = pinned.sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  }
  const reorderable = canReorderActive(device.activeSort);
  const activeThreads = sortActive(buckets.active, inputs.order, device.activeSort);
  const working = sortByManualOrder(buckets.working, inputs.order);
  const inactive = sortByManualOrder(buckets.inactive, inputs.order);
  const snoozed = sortSnoozed(buckets.snoozed, rowOf);
  const parked = sortParked(buckets.parked, rowOf);
  const settled = sortSettled(buckets.settled, rowOf);

  // Project mode groups Active; a drag preview puts a list's units in the pointer's order.
  const reorderLists = new Map<string, ReorderList>();
  const reorderOf = new Map<string, { listKey: string; unitKey: string }>();
  const projectName = (projectId: string) => inputs.projects.find((project) => project.id === projectId)?.name ?? projectId;

  const pinnedUnits: ReorderUnit[] = pinned.map((thread) => ({ key: thread.id, ids: [thread.id], title: thread.displayTitle }));
  const previewKeys = (listKey: string) => (inputs.drag?.listKey === listKey ? inputs.drag.unitKeys : null);
  const pinnedKeys = previewKeys("pinned");
  const pinnedOrdered = pinnedKeys === null ? pinnedUnits : followKeys(pinnedUnits, pinnedKeys);
  pinned = pinnedOrdered.map((unit) => forest.byId.get(unit.key)!);
  if (pinnedUnits.length > 0) {
    reorderLists.set("pinned", { key: "pinned", label: "Pinned", units: pinnedOrdered });
    for (const unit of pinnedOrdered) reorderOf.set(unit.key, { listKey: "pinned", unitKey: unit.key });
  }

  let entries: ActiveEntry[] =
    device.activeSort === "project" ? groupByProject(activeThreads, settings.groupByWorktree) : activeThreads.map((thread) => ({ kind: "thread", thread }));
  const groupKey = (projectId: string) => `group:${projectId}`;
  const worktreeKey = (environmentId: string) => `worktree:${environmentId}`;
  const threadUnit = (thread: PluginSidebarThread): ReorderUnit => ({ key: thread.id, ids: [thread.id], title: thread.displayTitle });
  const memberUnit = (member: GroupMember): ReorderUnit =>
    member.kind === "thread"
      ? threadUnit(member.thread)
      : { key: worktreeKey(member.environmentId), ids: member.threads.map((thread) => thread.id), title: member.branch };
  const memberKey = (member: GroupMember) => (member.kind === "thread" ? member.thread.id : worktreeKey(member.environmentId));
  if (reorderable && entries.length > 0) {
    const units: ReorderUnit[] = entries.map((entry) =>
      entry.kind === "thread"
        ? threadUnit(entry.thread)
        : { key: groupKey(entry.projectId), ids: entry.threads.map((thread) => thread.id), title: projectName(entry.projectId) },
    );
    const keys = previewKeys("active");
    const ordered = keys === null ? units : followKeys(units, keys);
    if (keys !== null) {
      const byKey = new Map(entries.map((entry, index) => [units[index]!.key, entry]));
      entries = ordered.map((unit) => byKey.get(unit.key)!);
    }
    reorderLists.set("active", { key: "active", label: "Active", units: ordered });
    for (const unit of ordered) {
      if (unit.key.startsWith("group:")) continue;
      reorderOf.set(unit.key, { listKey: "active", unitKey: unit.key });
    }
    entries = entries.map((entry) => {
      if (entry.kind !== "group") return entry;
      const listKey = groupKey(entry.projectId);
      const memberUnits = entry.members.map(memberUnit);
      const memberKeys = previewKeys(listKey);
      const orderedMembers = memberKeys === null ? memberUnits : followKeys(memberUnits, memberKeys);
      const byKey = new Map(entry.members.map((member) => [memberKey(member), member]));
      const members = orderedMembers.map((unit) => byKey.get(unit.key)!);
      reorderLists.set(listKey, { key: listKey, label: "Active", units: orderedMembers });
      for (const unit of orderedMembers) reorderOf.set(unit.key, { listKey, unitKey: unit.key });
      reorderOf.set(listKey, { listKey: "active", unitKey: listKey });
      // A worktree group reorders its own threads among themselves.
      const inside = members.map((member): GroupMember => {
        if (member.kind !== "worktree") return member;
        const innerKey = worktreeKey(member.environmentId);
        const innerUnits = member.threads.map(threadUnit);
        const innerKeys = previewKeys(innerKey);
        const orderedInner = innerKeys === null ? innerUnits : followKeys(innerUnits, innerKeys);
        reorderLists.set(innerKey, { key: innerKey, label: "Active", units: orderedInner });
        for (const unit of orderedInner) reorderOf.set(unit.key, { listKey: innerKey, unitKey: unit.key });
        return { ...member, threads: orderedInner.map((unit) => forest.byId.get(unit.key)!) };
      });
      return { ...entry, members: inside, threads: memberThreads(inside) };
    });
  }
  const activeOrder = flattenEntries(entries);
  const groupedProjects = new Set(entries.flatMap((entry) => (entry.kind === "group" ? [entry.projectId] : [])));
  const worktreeThreadIds = new Set(
    entries.flatMap((entry) => (entry.kind === "group" ? entry.members.flatMap((member) => (member.kind === "worktree" ? member.threads.map((thread) => thread.id) : [])) : [])),
  );

  const shelves: Record<Shelf, string[]> = { ...EMPTY_SHELVES };
  shelves.pinned = pinned.map((thread) => thread.id);
  shelves.active = activeOrder;
  shelves.working = working.map((thread) => thread.id);
  shelves.inactive = inactive.map((thread) => thread.id);
  shelves.snoozed = snoozed.map((thread) => thread.id);
  shelves.parked = parked.map((thread) => thread.id);
  shelves.settled = settled.map((thread) => thread.id);

  // Rows.
  const rows = new Map<string, RowView>();
  const expanded = new Set(device.expandedParents);
  const pathToOpen = pathOf(forest, activeThreadId);
  for (const thread of forest.byId.values()) {
    const shelf = shelfById.get(thread.id) ?? null;
    const tree = forest.treeOf.get(thread.id) ?? { working: isWorking(thread), needsYou: thread.hasPendingInteraction };
    const children = forest.children.get(thread.id) ?? null;
    const isExpanded = children !== null && expanded.has(thread.id);
    rows.set(thread.id, {
      id: thread.id,
      thread,
      shelf,
      card: shelf === null ? "slim" : cardKindOf(shelf, thread, tree, settings.compactWorkingThreads),
      lifecycle: lifecycle[thread.id] ?? null,
      woke: shelf === "active" ? wakeReason(lifecycle[thread.id], thread, now) : null,
      tree,
      grouped: shelf === "active" && groupedProjects.has(thread.projectId),
      inWorktree: shelf === "active" && worktreeThreadIds.has(thread.id),
      focused: thread.id === activeThreadId,
      openElsewhere: inputs.openElsewhereIds.has(thread.id) && thread.id !== activeThreadId,
      hasDraft: inputs.draftIds.has(thread.id),
      children,
      shownChildIds:
        children === null
          ? NO_IDS
          : isExpanded
            ? children.ids
            : children.ids.filter(
                (childId) => pathToOpen.has(childId) || (settings.showChildrenNeedingAttention && childHasStatus(forest.byId.get(childId)!)),
              ),
      expanded: isExpanded,
    });
  }

  // Items.
  const keptSet = new Set<string>();
  if (activeThreadId !== null) {
    const root = forest.rootOf.get(activeThreadId);
    if (root !== undefined) keptSet.add(root);
  }
  for (const id of inputs.frozenShelves.keys()) keptSet.add(id);
  const needsAttention = (id: string) => {
    const row = rows.get(id)!;
    const tree = forest.treeOf.get(id);
    return (tree?.needsYou ?? false) || treeFailed(forest, id) || isFailed(row.thread);
  };
  const itemsFor = (shelfList: readonly Shelf[]): ListItem[] => {
    const items: ListItem[] = [];
    for (const shelf of shelfList) {
      if (!shelfVisible(shelf, settings)) continue;
      const ids = shelves[shelf];
      if (ids.length === 0) continue;
      const collapsed = isShelfCollapsed(device, shelf);
      const shelfKey = `shelf:${shelf}`;
      items.push({
        kind: "shelf",
        key: shelfKey,
        shelf,
        count: ids.length,
        collapsed,
        spinning: shelf === "working" && ids.some((id) => rows.get(id)!.tree.working),
      });
      const keep = (id: string) => keptSet.has(id) || (settings.showChildrenNeedingAttention && needsAttention(id));
      if (shelf === "active" && groupedProjects.size > 0) {
        for (const entry of entries) {
          if (entry.kind === "thread") {
            if (!collapsed || keep(entry.thread.id)) items.push({ kind: "row", key: `row:${entry.thread.id}`, threadId: entry.thread.id, shelf, headers: [shelfKey] });
            continue;
          }
          const groupCollapsed = device.collapsedGroups.includes(entry.projectId);
          const shownThreads = entry.threads.filter((thread) => !(collapsed || groupCollapsed) || keep(thread.id));
          if (collapsed && shownThreads.length === 0) continue;
          items.push({ kind: "group", key: groupKey(entry.projectId), projectId: entry.projectId, count: entry.threads.length, collapsed: groupCollapsed, headers: [shelfKey] });
          const groupHeaders = [shelfKey, groupKey(entry.projectId)];
          const shownIds = new Set(shownThreads.map((thread) => thread.id));
          for (const member of entry.members) {
            if (member.kind === "thread") {
              if (shownIds.has(member.thread.id)) items.push({ kind: "row", key: `row:${member.thread.id}`, threadId: member.thread.id, shelf, headers: groupHeaders });
              continue;
            }
            if (!member.threads.some((thread) => shownIds.has(thread.id))) continue;
            const worktreeCollapsed = device.collapsedWorktrees.includes(member.environmentId);
            items.push({
              kind: "worktree",
              key: worktreeKey(member.environmentId),
              projectId: entry.projectId,
              environmentId: member.environmentId,
              branch: member.branch,
              count: member.threads.length,
              collapsed: worktreeCollapsed,
              urgency: worktreeCollapsed ? urgencyOfRoots(member.threads, forest.children) : null,
              headers: groupHeaders,
            });
            // A collapsed worktree group keeps only the rows bb needs drawn: the open thread's and the one being renamed.
            for (const thread of member.threads) {
              if (shownIds.has(thread.id) && (!worktreeCollapsed || keptSet.has(thread.id))) {
                items.push({ kind: "row", key: `row:${thread.id}`, threadId: thread.id, shelf, headers: [...groupHeaders, worktreeKey(member.environmentId)] });
              }
            }
          }
        }
        continue;
      }
      const shown = shelf === "settled" && !collapsed ? ids.slice(0, inputs.settledShown) : ids;
      for (const id of shown) if (!collapsed || keep(id)) items.push({ kind: "row", key: `row:${id}`, threadId: id, shelf, headers: [shelfKey] });
      if (shelf === "settled" && !collapsed && ids.length > shown.length) {
        const remaining = ids.length - shown.length;
        items.push({ kind: "more", key: "more:settled", remaining, next: Math.min(SETTLED_PAGE, remaining) });
      }
    }
    return items;
  };

  const upper = itemsFor(UPPER);
  const lower = itemsFor(LOWER);

  const quiet = shelves.pinned.length + shelves.active.length + shelves.working.length + shelves.inactive.length;
  const total = forest.roots.length;
  const scene: Scene | null =
    quiet === 0
      ? "all-clear"
      : settings.workingShelf && total > 0 && shelves.working.length === total
        ? "working"
        : null;

  return {
    rows,
    upper,
    lower,
    scene,
    shelves,
    reorderLists,
    reorderOf,
    pinnedWithRow: inputs.threads.filter((thread) => shouldClearForPin(lifecycle[thread.id], thread)).map((thread) => thread.id),
    openRootId: activeThreadId === null ? null : (forest.rootOf.get(activeThreadId) ?? null),
    nextDeadline: nextWakeAt(Object.values(lifecycle), now),
  };
}

const NO_IDS: readonly string[] = [];

/** The ids from the open thread up through its parents, as far as they sit under a parent's card. */
function pathOf(forest: Forest, threadId: string | null): Set<string> {
  const path = new Set<string>();
  for (let id = threadId; id !== null && id !== undefined; id = forest.parentOf.get(id) ?? null) {
    if (path.has(id)) break;
    path.add(id);
  }
  return path;
}

/** Whether any thread below the root failed. */
function treeFailed(forest: Forest, rootId: string): boolean {
  return (forest.children.get(rootId)?.counts.failed ?? 0) > 0;
}
