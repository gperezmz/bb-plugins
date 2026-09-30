// How components read the list store: one hook per part they draw, each a
// thin useSyncExternalStore over one selector, so a component renders only
// when its part changes. Components read the store through these alone.
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { PluginEnvironmentProvider, PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { Stamps, ThreadNotes } from "@/shared/contract";
import type { ClientPreferences, Preferences } from "@/shared/preferences";
import type { Commands } from "../commands/commands";
import { EMPTY_COUNTERS, type Counters } from "../model/counters";
import { providerDisplays, type ProviderDisplay } from "../model/provider-mark";
import type { MiniMapPane } from "../model/split";
import type { ThreadInfo, ThreadTree } from "../model/trees";
import type { GroupView, Row } from "../model/view";
import type { HostData, ListModel } from "./derive";
import { listStatusOf, type DropState, type ListLayout, type ListState, type ListStore, type ListUi, type OpenCard, type OpenMenu, type RowPlace } from "./list-store";

export type { ListLayout };

/** The mounted list's store and commands; one object for the list's life. */
export interface ListHandle {
  store: ListStore;
  commands: Commands;
}

// Debt: a provider made outside an app root, which boundaries-frontend-react
// refuses. The plugin has no app/ folder, and bb mounts the list itself
// through its slot, so the list's edge is the root that assembles it. It
// clears if the plugin gains an app root that mounts the list.
export const ListContext = createContext<ListHandle | null>(null);

function useHandle(): ListHandle {
  const handle = useContext(ListContext);
  if (handle === null) throw new Error("a list component needs the list's ListContext");
  return handle;
}

/** The part of `store`'s state `select` picks; `select` returns a value that keeps its identity while unchanged. */
function useSelect<T>(store: ListStore, select: (state: ListState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

function useListSelect<T>(select: (state: ListState) => T): T {
  return useSelect(useHandle().store, select);
}

export function useCommands(): Commands {
  return useHandle().commands;
}

const NO_IDS: readonly string[] = [];
/** Harness displays while the list has no model, as it unmounts. */
const NO_PROVIDERS = providerDisplays([]);

// ——— The list's edge, which holds its store before it provides it ———

const showArchivedOf = (state: ListState) => state.inputs.prefs.showArchived;

/** Show archived, which the edge passes to bb's thread hook. */
export function useShowArchivedOf(store: ListStore): boolean {
  return useSelect(store, showArchivedOf);
}

// ——— The list ———

/** What the list draws (see `listStatusOf`). */
export function useListStatus(): "error" | "loading" | "ready" {
  return useListSelect(listStatusOf);
}

export function useFocusedThreadId(): string | null {
  return useListSelect((state) => state.inputs.activeThreadId);
}

export function useEditingId(): string | null {
  return useListSelect((state) => state.ui.editingId);
}

export function useHasNoThreads(): boolean {
  return useListSelect((state) => state.inputs.host.threads.length === 0);
}

export function useArchived(): HostData["archived"] {
  return useListSelect((state) => state.inputs.host.archived);
}

export function useBranchedProjectIds(): readonly string[] {
  return useListSelect((state) => state.model?.branchedProjectIds ?? NO_IDS);
}

export function useLayout(): ListLayout {
  return useListSelect((state) => state.layout);
}

export function usePrefs(): Preferences {
  return useListSelect((state) => state.inputs.prefs);
}

export function useClient(): ClientPreferences {
  return useListSelect((state) => state.inputs.client);
}

export function useShowArchived(): boolean {
  return useListSelect(showArchivedOf);
}

/** The list's dialogs and what they show. */
export function useListUi(): ListUi {
  return useListSelect((state) => state.ui);
}

/** The whole model, for what spans the list (its dialogs); null until built. */
export function useListModel(): ListModel | null {
  return useListSelect((state) => state.model);
}

// ——— The list header ———

export function useNeedYouCount(): number {
  return useListSelect((state) => state.model?.view.needYouCount ?? 0);
}

export function useNeedYouOn(): boolean {
  return useListSelect((state) => state.inputs.needYouOn);
}

export function useListHasUnread(): boolean {
  return useListSelect((state) => state.model?.view.hasUnread ?? false);
}

// ——— Groups ———

export function useGroupIds(): readonly string[] {
  return useListSelect((state) => state.model?.groupIds ?? NO_IDS);
}

export function useMoreIds(): readonly string[] {
  return useListSelect((state) => state.model?.moreIds ?? NO_IDS);
}

export function useMoreCounters(): Counters {
  return useListSelect((state) => state.model?.view.moreCounters ?? EMPTY_COUNTERS);
}

export function useGroup(groupId: string): GroupView | undefined {
  return useListSelect((state) => state.model?.groupsById.get(groupId));
}

/** A dragged group header is over this group. */
export function useIsGroupDropTarget(groupId: string): boolean {
  return useListSelect((state) => state.ui.dropGroupId === groupId);
}

/** The group holds the focused thread: on phones only it shows `+`. */
export function useHoldsFocus(groupId: string): boolean {
  return useListSelect((state) => state.model?.activeGroupId === groupId);
}

// ——— Rows ———

/** A row's key in the list: its group, then its key within the group. */
export function itemKeyOf(groupId: string, rowKey: string): string {
  return `${groupId}/${rowKey}`;
}

/** A thread row's own part of the list: focus, rename, split mini-map, draft, row status, and its menu or drag. */
export interface RowState {
  focused: boolean;
  editing: boolean;
  miniMap: readonly MiniMapPane[] | null;
  hasDraft: boolean;
  rowStatus: PluginSidebarThreadRowStatus | null;
  /** A menu or context menu is open from this row. */
  menuOpen: boolean;
  /** This row is being dragged. */
  dragging: boolean;
}

const ROW_STATE_KEYS: readonly (keyof RowState)[] = ["focused", "editing", "miniMap", "hasDraft", "rowStatus", "menuOpen", "dragging"];

// One object per row while its parts hold, so the row's selector keeps its identity.
const rowStates = new WeakMap<ListStore, Map<string, RowState>>();

function sameRow(place: RowPlace, groupId: string, rowKey: string): boolean {
  return place.groupId === groupId && place.rowKey === rowKey;
}

export function useRow(threadId: string, groupId: string, rowKey: string): RowState {
  const store = useHandle().store;
  const key = itemKeyOf(groupId, rowKey);
  return useSelect(store, (state) => {
    let cache = rowStates.get(store);
    if (cache === undefined) rowStates.set(store, (cache = new Map()));
    const { ui, inputs } = state;
    const menu = ui.menu;
    const next: RowState = {
      focused: inputs.activeThreadId === threadId,
      editing: ui.editingId === threadId,
      miniMap: state.model?.miniMaps.get(threadId) ?? null,
      hasDraft: inputs.host.draftIds.has(threadId),
      rowStatus: inputs.host.rowStatuses.get(threadId) ?? null,
      menuOpen: menu !== null && menu.kind !== "group" && sameRow(menu, groupId, rowKey),
      dragging: ui.dragging?.kind === "thread" && sameRow(ui.dragging, groupId, rowKey),
    };
    const last = cache.get(key);
    if (last !== undefined && ROW_STATE_KEYS.every((name) => last[name] === next[name])) return last;
    cache.set(key, next);
    return next;
  });
}

/** The group header, or with `rowKey` the environment row, is being renamed. */
export function useRenaming(groupId: string, rowKey: string | null): boolean {
  return useListSelect((state) => state.ui.renaming?.groupId === groupId && state.ui.renaming.rowKey === rowKey);
}

/** An environment row's menu is open. */
export function useEnvironmentMenuOpen(groupId: string, rowKey: string): boolean {
  return useListSelect((state) => state.ui.menu?.kind === "environment" && sameRow(state.ui.menu, groupId, rowKey));
}

/** Rows that stay mounted wherever the list is scrolled, as thread ids and as `groupId/rowKey` keys. */
export interface KeptRows {
  threadIds: readonly string[];
  itemKeys: readonly string[];
}

const keptCache = new WeakMap<ListStore, KeptRows>();

/**
 * The focused thread's rows, the row being renamed, the row holding keyboard
 * focus, the row a menu, context menu or hover card is open from, and the
 * row being dragged.
 */
export function useKeptRows(): KeptRows {
  const store = useHandle().store;
  return useSelect(store, (state) => {
    const { ui, inputs } = state;
    const threadIds = [inputs.activeThreadId, ui.editingId].filter((id): id is string => id !== null);
    const itemKeys: string[] = [];
    if (ui.focusKey !== null) itemKeys.push(ui.focusKey);
    if (ui.renaming !== null && ui.renaming.rowKey !== null) itemKeys.push(itemKeyOf(ui.renaming.groupId, ui.renaming.rowKey));
    if (ui.menu !== null && ui.menu.kind !== "group") itemKeys.push(itemKeyOf(ui.menu.groupId, ui.menu.rowKey));
    if (ui.card !== null) itemKeys.push(itemKeyOf(ui.card.groupId, ui.card.rowKey));
    if (ui.dragging?.kind === "thread") itemKeys.push(itemKeyOf(ui.dragging.groupId, ui.dragging.rowKey));
    const last = keptCache.get(store);
    if (last !== undefined && last.threadIds.join(" ") === threadIds.join(" ") && last.itemKeys.join(" ") === itemKeys.join(" ")) return last;
    const next = { threadIds, itemKeys };
    keptCache.set(store, next);
    return next;
  });
}

/** The group header being dragged. */
export function useIsGroupDragged(groupId: string): boolean {
  return useListSelect((state) => state.ui.dragging?.kind === "group" && state.ui.dragging.groupId === groupId);
}

/** The group's menu is open. */
export function useGroupMenuOpen(groupId: string): boolean {
  return useListSelect((state) => state.ui.menu?.kind === "group" && state.ui.menu.groupId === groupId);
}

/** The menu open in the list, for its host. */
export function useOpenMenu(): OpenMenu | null {
  return useListSelect((state) => state.ui.menu);
}

/** The hover card open in the list, for its host. */
export function useOpenCard(): OpenCard | null {
  return useListSelect((state) => state.ui.card);
}

/** A row by its group and key, while it is drawn. */
export function useRowAt(groupId: string, rowKey: string): Row | undefined {
  return useListSelect((state) => state.model?.groupsById.get(groupId)?.rows.find((row) => row.key === rowKey));
}

/** The thread under the pointer, for bb's one drag-to-split hook. */
export function useProbeId(): string | null {
  return useListSelect((state) => state.ui.probeId ?? state.inputs.activeThreadId ?? state.inputs.host.threads[0]?.id ?? null);
}

/** bb offers splits here. */
export function useSplitAvailable(): boolean {
  return useListSelect((state) => state.ui.splitAvailable);
}

/** Groups' views for `ids`, the same array while every one of them holds. */
export function useGroups(ids: readonly string[]): readonly GroupView[] {
  const store = useHandle().store;
  const last = useRef<readonly GroupView[]>([]);
  return useSelect(store, (state) => {
    const groups = ids.flatMap((id) => {
      const group = state.model?.groupsById.get(id);
      return group === undefined ? [] : [group];
    });
    const previous = last.current;
    if (previous.length === groups.length && previous.every((group, index) => group === groups[index])) return previous;
    last.current = groups;
    return groups;
  });
}

/** One object per harness, the same on every call. */
export function useProviderDisplay(providerId: string): ProviderDisplay {
  return useListSelect((state) => (state.model?.providerDisplay ?? NO_PROVIDERS)(providerId));
}

export function useEnvironmentProviderList(): readonly PluginEnvironmentProvider[] {
  return useListSelect((state) => state.inputs.host.environmentProviders);
}

// ——— Details, for an open hover card or dialog ———

export function useStampMaps(): Stamps {
  return useListSelect((state) => state.inputs.stamps);
}

/** The list clock's time. */
export function useNow(): number {
  return useListSelect((state) => state.inputs.now);
}

export function useNotesOf(threadId: string): ThreadNotes | undefined {
  return useListSelect((state) => state.inputs.notes[threadId]);
}

export function useTreeOf(threadId: string): ThreadTree | undefined {
  return useListSelect((state) => state.model?.forest.treeOf.get(threadId));
}

/** A thread's info while it is loaded, for an open hover card. */
export function useThreadInfo(threadId: string): ThreadInfo | undefined {
  return useListSelect((state) => state.model?.forest.infos.get(threadId));
}

/** The drop feedback drawn while a thread is dragged over a row: the row's thread and what dropping does. */
export function useDropFeedback(): { threadId: string; state: DropState } | null {
  const store = useHandle().store;
  const last = useRef<{ threadId: string; state: DropState } | null>(null);
  return useSelect(store, (state) => {
    const first = state.ui.dropStates.entries().next();
    const next = first.done ? null : { threadId: first.value[0], state: first.value[1] };
    const previous = last.current;
    if (previous?.threadId === next?.threadId && previous?.state === next?.state) return previous;
    last.current = next;
    return next;
  });
}
