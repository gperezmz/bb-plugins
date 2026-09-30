// How components read the list store: one hook per part they draw, each a
// thin useSyncExternalStore over one selector, so a component renders only
// when its part changes. Components read the store through these alone.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk/app";
import type { Stamps, ThreadNotes } from "@/shared/contract";
import type { ClientPreferences, Preferences } from "@/shared/preferences";
import type { Commands } from "../commands/commands";
import { EMPTY_COUNTERS, type Counters } from "../model/counters";
import { providerDisplays, type ProviderDisplay } from "../model/provider-mark";
import type { MiniMapPane } from "../model/split";
import type { ThreadTree } from "../model/trees";
import type { GroupView } from "../model/view";
import type { HostData, ListModel } from "./derive";
import type { DropState, ListLayout, ListState, ListStore, ListUi } from "./list-store";

export type { ListLayout };

/** The mounted list's store and commands; one object for the list's life. */
export interface ListHandle {
  store: ListStore;
  commands: Commands;
}

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

/** Show archived, which the edge passes to bb's thread hook. */
export function useShowArchivedOf(store: ListStore): boolean {
  return useSelect(store, (state) => state.inputs.prefs.showArchived);
}

// ——— The list ———

/** What the list draws: bb's error, a skeleton while anything it needs is on its way, or the list. */
export function useListStatus(): "error" | "loading" | "ready" {
  return useListSelect((state) =>
    state.inputs.host.status === "error"
      ? "error"
      : state.inputs.host.status === "loading" || !state.inputs.hydrated || state.model === null
        ? "loading"
        : "ready",
  );
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
  return useListSelect((state) => state.inputs.prefs.showArchived);
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

/** A thread row's own part of the list: focus, rename, drop feedback and split mini-map. */
export interface RowState {
  focused: boolean;
  editing: boolean;
  dropState: DropState | null;
  miniMap: readonly MiniMapPane[] | null;
}

// One object per row while its parts hold, so the row's selector keeps its identity.
const rowStates = new WeakMap<ListStore, Map<string, RowState>>();

export function useRow(threadId: string): RowState {
  const store = useHandle().store;
  return useSelect(store, (state) => {
    let cache = rowStates.get(store);
    if (cache === undefined) rowStates.set(store, (cache = new Map()));
    const next: RowState = {
      focused: state.inputs.activeThreadId === threadId,
      editing: state.ui.editingId === threadId,
      dropState: state.ui.dropStates.get(threadId) ?? null,
      miniMap: state.model?.miniMaps.get(threadId) ?? null,
    };
    const last = cache.get(threadId);
    if (
      last !== undefined &&
      last.focused === next.focused &&
      last.editing === next.editing &&
      last.dropState === next.dropState &&
      last.miniMap === next.miniMap
    ) {
      return last;
    }
    cache.set(threadId, next);
    return next;
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

export function useClock(): number {
  return useListSelect((state) => state.inputs.now);
}

export function useNotesOf(threadId: string): ThreadNotes | undefined {
  return useListSelect((state) => state.inputs.notes[threadId]);
}

export function useTreeOf(threadId: string): ThreadTree | undefined {
  return useListSelect((state) => state.model?.forest.treeOf.get(threadId));
}
