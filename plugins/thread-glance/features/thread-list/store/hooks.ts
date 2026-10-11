// How components read the list store: one hook per part they draw, each a
// thin useSyncExternalStore over one selector, so a component renders only
// when its part changes. Components read the store through these alone.
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import type { Shelf } from "@/shared/lifecycle";
import type { Settings } from "@/shared/settings";
import type { Commands } from "../commands/commands";
import { heightsFor, type Heights } from "../model/heights";
import type { ListItem, ListModel, RowView, Scene } from "../model/list-model";
import { resolveScope } from "../model/scope";
import { isShelfCollapsed, type ActiveSort, type DeviceState } from "../storage/device-state";
import { listStatusOf, type ListState, type ListStore } from "./list-store";

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
export function useSelect<T>(store: ListStore, select: (state: ListState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

function useListSelect<T>(select: (state: ListState) => T): T {
  return useSelect(useHandle().store, select);
}

export function useCommands(): Commands {
  return useHandle().commands;
}

export function useListStore(): ListStore {
  return useHandle().store;
}

const NO_ITEMS: readonly ListItem[] = [];
const NO_ROWS: readonly RowView[] = [];

// ——— The list ———

/** What the list draws (see `listStatusOf`). */
export function useListStatus(): "error" | "loading" | "ready" {
  return useListSelect(listStatusOf);
}

export function useCompact(): boolean {
  return useListSelect((state) => state.inputs.compact);
}

export function useHeights(): Heights {
  return heightsFor(useCompact());
}

export function useSettings(): Settings {
  return useListSelect((state) => state.inputs.settings);
}

export function useDevice(): DeviceState {
  return useListSelect((state) => state.inputs.device);
}

export function useActiveSort(): ActiveSort {
  return useListSelect((state) => state.inputs.device.activeSort);
}

export function useShelfCollapsed(shelf: Shelf): boolean {
  return useListSelect((state) => isShelfCollapsed(state.inputs.device, shelf));
}

export function useGroupCollapsed(projectId: string): boolean {
  return useListSelect((state) => state.inputs.device.collapsedGroups.includes(projectId));
}

export function useScene(): Scene | null {
  return useListSelect((state) => state.model?.scene ?? null);
}

/** The upper group's items: Pinned, then Active. */
export function useUpperItems(): readonly ListItem[] {
  return useListSelect((state) => state.model?.upper ?? NO_ITEMS);
}

/** The lower group's items: Working, Inactive, Snoozed, Parked, Settled. */
export function useLowerItems(): readonly ListItem[] {
  return useListSelect((state) => state.model?.lower ?? NO_ITEMS);
}

/** The model's rows, for the windowing layout. */
export function useRows(): ReadonlyMap<string, RowView> {
  return useListSelect((state) => state.model?.rows ?? NO_ROW_MAP);
}

const NO_ROW_MAP: ReadonlyMap<string, RowView> = new Map();

/** The project scope in force and the projects it picks among. */
export function useScope(): { scopeId: string | null; projects: readonly PluginSidebarProject[] } {
  const store = useListStore();
  const last = useRef<{ scopeId: string | null; projects: readonly PluginSidebarProject[] } | null>(null);
  return useSelect(store, (state) => {
    const { scopeId, host } = state.inputs;
    const next = { scopeId: resolveScope(scopeId, host.projects), projects: host.projects };
    const previous = last.current;
    if (previous !== null && previous.scopeId === next.scopeId && previous.projects === next.projects) return previous;
    last.current = next;
    return next;
  });
}

/** A project by id, or null. */
export function useProject(projectId: string): PluginSidebarProject | null {
  return useListSelect((state) => state.inputs.host.projects.find((project) => project.id === projectId) ?? null);
}

// ——— Rows ———

/** One row's part of the model, by thread id: it changes only when that thread's row does. */
export function useRow(threadId: string): RowView | undefined {
  return useListSelect((state) => state.model?.rows.get(threadId));
}

/** The rows of `ids`, the same array while every one of them holds. */
export function useRowsOf(ids: readonly string[]): readonly RowView[] {
  const store = useListStore();
  const last = useRef<readonly RowView[]>(NO_ROWS);
  return useSelect(store, (state) => {
    const found = ids.flatMap((id) => {
      const row = state.model?.rows.get(id);
      return row === undefined ? [] : [row];
    });
    const previous = last.current;
    if (previous.length === found.length && previous.every((row, index) => row === found[index])) return previous;
    last.current = found;
    return found;
  });
}

/** The thread is being renamed in place. */
export function useIsRenaming(threadId: string): boolean {
  return useListSelect((state) => state.ui.editingId === threadId);
}

/** The row or group is being dragged. */
export function useIsDragged(unitKey: string): boolean {
  return useListSelect((state) => state.ui.dragging?.unitKey === unitKey);
}

/** Whether a drag runs anywhere in the list. */
export function useIsDragging(): boolean {
  return useListSelect((state) => state.ui.dragging !== null);
}

/** Whether the Clean settled resources dialog is open. */
export function useCleanOpen(): boolean {
  return useListSelect((state) => state.ui.cleanOpen);
}

/** The live region's text. */
export function useAnnouncement(): string {
  return useListSelect((state) => state.ui.announcement);
}

/** The list clock's time in whole minutes, for labels that read "5m" and refresh every minute. */
export function useMinute(): number {
  return useListSelect((state) => Math.floor(state.inputs.now / 60_000));
}

/** The list clock's time. It changes every minute and at a snooze's end. */
export function useNow(): number {
  return useListSelect((state) => state.inputs.now);
}

export function useModel(): ListModel | null {
  return useListSelect((state) => state.model);
}
