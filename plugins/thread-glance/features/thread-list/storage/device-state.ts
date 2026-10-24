// What the list keeps per device: which shelves are collapsed, the Active sort,
// collapsed project and worktree groups, the parents whose child list is open
// and the pinned projects. Pure steps over plain values; `readDeviceState` and
// the cache helpers bind them to storage.
import { lifecycleRowSchema, SHELVES, type LifecycleRow, type Shelf } from "@/shared/lifecycle";
import { readSettings, type Settings } from "@/shared/settings";
import { appearanceSchema, type Appearance } from "@/shared/signals";
import { CAPS, type DeviceStorage } from "./device-storage";

export const ACTIVE_SORTS = ["manual", "activity", "created", "project"] as const;
export type ActiveSort = (typeof ACTIVE_SORTS)[number];

export const ACTIVE_SORT_LABELS: Record<ActiveSort, string> = {
  manual: "Manual order",
  activity: "Recent activity",
  created: "Date created",
  project: "Project",
};

export interface DeviceState {
  /** Shelves the person opened or collapsed; absent shelves follow `DEFAULT_COLLAPSED`. */
  collapsedShelves: Readonly<Partial<Record<Shelf, boolean>>>;
  activeSort: ActiveSort;
  /** Project ids whose Project-mode group is collapsed. */
  collapsedGroups: readonly string[];
  /** Worktree environment ids whose group inside a Project-mode group is collapsed. */
  collapsedWorktrees: readonly string[];
  /** Thread ids whose child list is open, least recently opened first. */
  expandedParents: readonly string[];
  /** Project ids pinned above the list, in the order they were pinned. */
  pinnedProjects: readonly string[];
}

/** Pinned, Active and Working start open; the rest start collapsed. */
export const DEFAULT_COLLAPSED: Readonly<Record<Shelf, boolean>> = {
  pinned: false,
  active: false,
  working: false,
  inactive: true,
  snoozed: true,
  parked: true,
  settled: true,
};

export const INITIAL_DEVICE_STATE: DeviceState = {
  collapsedShelves: {},
  activeSort: "manual",
  collapsedGroups: [],
  collapsedWorktrees: [],
  expandedParents: [],
  pinnedProjects: [],
};

export function isShelfCollapsed(state: Pick<DeviceState, "collapsedShelves">, shelf: Shelf): boolean {
  return state.collapsedShelves[shelf] ?? DEFAULT_COLLAPSED[shelf];
}

/** `ids` without repeats, keeping the last `cap`: the most recent entries are at the end. */
function lastDistinct(ids: readonly string[], cap: number): string[] {
  const distinct = [...new Set(ids.slice().reverse())].reverse();
  return distinct.slice(-cap);
}

export function withShelfCollapsed(state: DeviceState, shelf: Shelf, collapsed: boolean): DeviceState {
  if (isShelfCollapsed(state, shelf) === collapsed) return state;
  return { ...state, collapsedShelves: { ...state.collapsedShelves, [shelf]: collapsed } };
}

export function withActiveSort(state: DeviceState, activeSort: ActiveSort): DeviceState {
  return state.activeSort === activeSort ? state : { ...state, activeSort };
}

export function withGroupCollapsed(state: DeviceState, projectId: string, collapsed: boolean): DeviceState {
  const has = state.collapsedGroups.includes(projectId);
  if (has === collapsed) return state;
  const collapsedGroups = collapsed
    ? lastDistinct([...state.collapsedGroups, projectId], CAPS.collapsedGroups)
    : state.collapsedGroups.filter((id) => id !== projectId);
  return { ...state, collapsedGroups };
}

export function withWorktreeCollapsed(state: DeviceState, environmentId: string, collapsed: boolean): DeviceState {
  const has = state.collapsedWorktrees.includes(environmentId);
  if (has === collapsed) return state;
  const collapsedWorktrees = collapsed
    ? lastDistinct([...state.collapsedWorktrees, environmentId], CAPS.collapsedWorktrees)
    : state.collapsedWorktrees.filter((id) => id !== environmentId);
  return { ...state, collapsedWorktrees };
}

/** Opens or closes a parent's child list; opening makes it the most recent, and only the last 100 stay open. */
export function withParentExpanded(state: DeviceState, threadId: string, expanded: boolean): DeviceState {
  const has = state.expandedParents.includes(threadId);
  if (expanded && state.expandedParents[state.expandedParents.length - 1] === threadId) return state;
  if (!expanded && !has) return state;
  const expandedParents = expanded
    ? lastDistinct([...state.expandedParents, threadId], CAPS.expandedParents)
    : state.expandedParents.filter((id) => id !== threadId);
  return { ...state, expandedParents };
}

/** Closes the child lists of `threadIds` at once. */
export function withParentsClosed(state: DeviceState, threadIds: readonly string[]): DeviceState {
  const expandedParents = without(state.expandedParents, threadIds);
  return expandedParents.length === state.expandedParents.length ? state : { ...state, expandedParents };
}

/**
 * Removes `threadIds` from the stored open parents, from what the storage
 * holds now rather than from this window's copy, so a window that closes
 * lists nobody asked it to close does not undo what another window opened.
 */
export function closeStoredParents(storage: DeviceStorage, threadIds: readonly string[]): void {
  const stored = stringList(storage.read("expandedParents"), CAPS.expandedParents);
  const kept = without(stored, threadIds);
  if (kept.length !== stored.length) storage.write("expandedParents", kept);
}

function without(list: readonly string[], ids: readonly string[]): string[] {
  const removed = new Set(ids);
  return list.filter((id) => !removed.has(id));
}

/** Pins or unpins a project; a pin past the cap drops the oldest. */
export function withProjectPinned(state: DeviceState, projectId: string, pinned: boolean): DeviceState {
  const has = state.pinnedProjects.includes(projectId);
  if (has === pinned) return state;
  const pinnedProjects = pinned
    ? lastDistinct([...state.pinnedProjects, projectId], CAPS.pinnedProjects)
    : state.pinnedProjects.filter((id) => id !== projectId);
  return { ...state, pinnedProjects };
}

function stringList(value: unknown, cap: number): string[] {
  return Array.isArray(value) ? lastDistinct(value.filter((entry): entry is string => typeof entry === "string"), cap) : [];
}

/** The questions and queued failures seen on this device (see `seenWaits`), as another window may have left them. */
export function readSeenWaits(storage: DeviceStorage): ReadonlySet<string> {
  return new Set(stringList(storage.read("seenWaits"), CAPS.seenWaits));
}

export function writeSeenWaits(storage: DeviceStorage, seen: ReadonlySet<string>): void {
  storage.write("seenWaits", [...seen].slice(-CAPS.seenWaits));
}

/** The pinned projects saved in `storage`, which another window may have changed since this one read them. */
export function readPinnedProjects(storage: DeviceStorage): readonly string[] {
  return stringList(storage.read("pinnedProjects"), CAPS.pinnedProjects);
}

export function readDeviceState(storage: DeviceStorage): DeviceState {
  const stored = storage.read("collapsedShelves");
  const collapsedShelves: Partial<Record<Shelf, boolean>> = {};
  if (stored !== null && typeof stored === "object") {
    for (const shelf of SHELVES) {
      const value = (stored as Record<string, unknown>)[shelf];
      if (typeof value === "boolean") collapsedShelves[shelf] = value;
    }
  }
  const sort = storage.read("activeSort");
  return {
    collapsedShelves,
    activeSort: ACTIVE_SORTS.find((candidate) => candidate === sort) ?? "manual",
    collapsedGroups: stringList(storage.read("collapsedGroups"), CAPS.collapsedGroups),
    collapsedWorktrees: stringList(storage.read("collapsedWorktrees"), CAPS.collapsedWorktrees),
    expandedParents: stringList(storage.read("expandedParents"), CAPS.expandedParents),
    pinnedProjects: readPinnedProjects(storage),
  };
}

/** Writes the keys of `state` that differ from `previous`. */
export function saveDeviceState(storage: DeviceStorage, previous: DeviceState, state: DeviceState): void {
  if (previous.collapsedShelves !== state.collapsedShelves) storage.write("collapsedShelves", state.collapsedShelves);
  if (previous.activeSort !== state.activeSort) storage.write("activeSort", state.activeSort);
  if (previous.collapsedGroups !== state.collapsedGroups) storage.write("collapsedGroups", state.collapsedGroups);
  if (previous.collapsedWorktrees !== state.collapsedWorktrees) storage.write("collapsedWorktrees", state.collapsedWorktrees);
  if (previous.expandedParents !== state.expandedParents) storage.write("expandedParents", state.expandedParents);
  if (previous.pinnedProjects !== state.pinnedProjects) storage.write("pinnedProjects", state.pinnedProjects);
}

// ——— Caches of what the server sends, for the first draw ———

/** The newest mark on a row: the rows kept when the cache is capped are the ones set most recently. */
function markedAt(row: LifecycleRow): number {
  return Math.max(row.settledAt ?? 0, row.parkedAt ?? 0, row.snoozedAt ?? 0, row.snoozeUntil ?? 0);
}

/** At most `CAPS.lifecycleRows` rows, the most recently marked first kept. */
export function capLifecycleRows(rows: Readonly<Record<string, LifecycleRow>>): Record<string, LifecycleRow> {
  const entries = Object.entries(rows);
  if (entries.length <= CAPS.lifecycleRows) return { ...rows };
  entries.sort((a, b) => markedAt(b[1]) - markedAt(a[1]));
  return Object.fromEntries(entries.slice(0, CAPS.lifecycleRows));
}

export function readRowsCache(storage: DeviceStorage): Record<string, LifecycleRow> | null {
  const stored = storage.read("cache.rows");
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const rows: Record<string, LifecycleRow> = {};
  for (const [threadId, value] of Object.entries(stored)) {
    const parsed = lifecycleRowSchema.safeParse(value);
    if (parsed.success) rows[threadId] = parsed.data;
  }
  return capLifecycleRows(rows);
}

export function writeRowsCache(storage: DeviceStorage, rows: Readonly<Record<string, LifecycleRow>>): void {
  storage.write("cache.rows", capLifecycleRows(rows));
}

export function readOrderCache(storage: DeviceStorage): string[] | null {
  const stored = storage.read("cache.order");
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(0, CAPS.orderIds) : null;
}

export function writeOrderCache(storage: DeviceStorage, order: readonly string[]): void {
  storage.write("cache.order", order.slice(0, CAPS.orderIds));
}

export function readSettingsCache(storage: DeviceStorage): Settings | null {
  const stored = storage.read("cache.settings");
  return stored === null ? null : readSettings(stored);
}

export function writeSettingsCache(storage: DeviceStorage, settings: Settings): void {
  storage.write("cache.settings", settings);
}

export function readAppearanceCache(storage: DeviceStorage): Appearance | null {
  const parsed = appearanceSchema.safeParse(storage.read("cache.appearance"));
  return parsed.success ? parsed.data : null;
}

export function writeAppearanceCache(storage: DeviceStorage, appearance: Appearance): void {
  storage.write("cache.appearance", appearance);
}

// ——— The port link machine ———

/** The id of the machine whose web ports the hover card links to, or null for "No machine". */
export function readPortLinkMachine(storage: DeviceStorage): string | null {
  const stored = storage.read("portLinkMachine");
  return typeof stored === "string" && stored !== "" ? stored : null;
}

export function writePortLinkMachine(storage: DeviceStorage, machineId: string | null): void {
  if (machineId === null) storage.remove("portLinkMachine");
  else storage.write("portLinkMachine", machineId);
}
