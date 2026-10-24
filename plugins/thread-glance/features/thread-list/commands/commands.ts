// The list's commands: what a person does to the list (open a thread, fold a
// shelf, pick a scope, rename), with the lifecycle commands and the reorder
// commands under the same object. Components and menus call these and nothing
// else; each runs against the store's edge when it is called.
import { toast } from "sonner";
import type { Shelf } from "@/shared/lifecycle";
import { treeHasBusy, waitingChildTitle } from "../model/forest";
import { SETTLED_PAGE } from "../model/list-model";
import type { Scope } from "../model/scope";
import {
  withActiveSort,
  withGroupCollapsed,
  withParentExpanded,
  withProjectPinned,
  withShelfCollapsed,
  withWorktreeCollapsed,
  isShelfCollapsed,
  type ActiveSort,
} from "../storage/device-state";
import type { ListStore } from "../store/list-store";
import { pluginData } from "../sync";
import { createLifecycleCommands, type LifecycleCommands } from "./lifecycle";
import { dismissPortsPrompt } from "./ports-prompt";
import { createPortCommands, type PortCommands } from "./ports";
import { createReorderCommands, type ReorderCommands } from "./reorder";

export const GROUP_BY_WORKTREE_FAILED = "Could not change Group by worktree";

export interface ListCommands {
  /** Opens a thread; `split` asks for bb's split placement. */
  open(threadId: string, options?: { split?: boolean }): void;
  toggleShelf(shelf: Shelf): void;
  setActiveSort(sort: ActiveSort): void;
  /** Collapses or opens a Project-mode group. */
  setGroupCollapsed(projectId: string, collapsed: boolean): void;
  /** Collapses or opens a worktree group inside a Project-mode group. */
  setWorktreeCollapsed(environmentId: string, collapsed: boolean): void;
  /** Flips the Group by worktree setting for every window; a click while the last flip is still being saved is ignored. */
  toggleGroupByWorktree(): Promise<void>;
  /** Opens or closes a parent's child list on this device. */
  setExpanded(parentId: string, expanded: boolean): void;
  /** Picks the project scope (empty for All projects) and keeps it for this window. */
  setScope(scope: Scope): void;
  /** Pins a project above the list or unpins it, on this device. */
  setProjectPinned(projectId: string, pinned: boolean): void;
  /** Shows the next page of Settled. */
  loadMoreSettled(): void;
  /** Starts renaming a row in place; the row keeps its shelf until `endRename`. */
  beginRename(threadId: string): void;
  endRename(): void;
  /** Saves a trimmed, changed title. */
  rename(threadId: string, title: string): Promise<void>;
  unpin(threadId: string): Promise<void>;
  /** Opens the Clean settled resources dialog. */
  openClean(): void;
  closeClean(): void;
}

export type Commands = ListCommands & LifecycleCommands & ReorderCommands & PortCommands;

export function createCommands(store: ListStore): Commands {
  let savingGroupByWorktree = false;
  const own: ListCommands = {
    open(threadId, options) {
      dismissPortsPrompt(threadId);
      store.edge.navigate.toThread(threadId, options?.split ? { split: true } : undefined);
      store.edge.onNavigate();
    },

    toggleShelf(shelf) {
      store.updateDevice((device) => withShelfCollapsed(device, shelf, !isShelfCollapsed(device, shelf)));
    },

    setActiveSort(sort) {
      store.updateDevice((device) => withActiveSort(device, sort));
    },

    setGroupCollapsed(projectId, collapsed) {
      store.updateDevice((device) => withGroupCollapsed(device, projectId, collapsed));
    },

    setWorktreeCollapsed(environmentId, collapsed) {
      store.updateDevice((device) => withWorktreeCollapsed(device, environmentId, collapsed));
    },

    async toggleGroupByWorktree() {
      if (savingGroupByWorktree) return;
      savingGroupByWorktree = true;
      try {
        const on = !store.getState().inputs.settings.groupByWorktree;
        pluginData.settingsSignal(await store.edge.rpc.call("writeSettings", { patch: { groupByWorktree: on } }));
      } catch {
        toast.error(GROUP_BY_WORKTREE_FAILED);
      } finally {
        savingGroupByWorktree = false;
      }
    },

    setExpanded(parentId, expanded) {
      store.updateDevice((device) => withParentExpanded(device, parentId, expanded));
    },

    setScope(scope) {
      store.feed({ scope });
    },

    setProjectPinned(projectId, pinned) {
      store.updateDevice((device) => withProjectPinned(device, projectId, pinned));
    },

    loadMoreSettled() {
      store.feed(({ settledShown }) => ({ settledShown: settledShown + SETTLED_PAGE }));
    },

    beginRename(threadId) {
      const shelf = store.getState().model?.rows.get(threadId)?.shelf ?? null;
      store.setUi({ editingId: threadId });
      if (shelf === null) return;
      store.feed(({ frozenShelves }) => ({ frozenShelves: new Map(frozenShelves).set(threadId, shelf) }));
    },

    endRename() {
      store.setUi({ editingId: null });
      store.feed(({ frozenShelves }) => (frozenShelves.size === 0 ? {} : { frozenShelves: new Map() }));
    },

    async rename(threadId, title) {
      dismissPortsPrompt(threadId);
      const row = store.getState().model?.rows.get(threadId);
      const next = title.trim();
      if (row === undefined || next === "" || next === row.thread.displayTitle) return;
      try {
        await store.edge.sdk.threads.update({ threadId, title: next });
      } catch {
        toast.error("Could not rename thread");
      }
    },

    openClean() {
      store.setUi({ cleanOpen: true });
    },

    closeClean() {
      store.setUi({ cleanOpen: false });
    },

    async unpin(threadId) {
      dismissPortsPrompt(threadId);
      try {
        await store.edge.sdk.threads.unpin({ threadId });
      } catch {
        toast.error("Could not unpin thread");
      }
    },
  };
  const lifecycle = createLifecycleCommands({
    rpc: () => store.edge.rpc,
    thread: (threadId) => store.getState().model?.rows.get(threadId)?.thread ?? null,
    childWaiting: (threadId) => {
      const rows = store.getState().model?.rows;
      return rows === undefined ? null : waitingChildTitle([...rows.values()].map((row) => row.thread), threadId);
    },
    treeBusy: (threadId) => {
      const rows = store.getState().model?.rows;
      return rows !== undefined && treeHasBusy([...rows.values()].map((row) => row.thread), threadId);
    },
  });
  return { ...own, ...lifecycle, ...createReorderCommands(store), ...createPortCommands(() => store.edge.rpc) };
}
