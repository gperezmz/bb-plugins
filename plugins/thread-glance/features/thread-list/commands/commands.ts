// What a person can do in the list, as plain commands with one identity for
// the list's life. Each reads the store and bb's calls when it runs, so no
// component is handed a callback that changes when threads change.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ClientPreferences, Preferences } from "@/shared/preferences";
import { modelDisplayName } from "../model/details";
import { resolveDrop, type DraggedThread, type DropAction, type DropContext, type DropTarget } from "../model/drag";
import { pruneTargets } from "../model/expansion";
import { moveGroup, ORDER_PREFERENCE } from "../model/groups";
import { MARK_ALL_CONFIRM_ABOVE, type RowMenuAction } from "../model/menu";
import { markAllReadPlan, markReadPlanFor, toggleChip, toggleGroup, toggleOlder, toggleSettled, type ToggleOutcome } from "../model/toggles";
import type { ThreadTree } from "../model/trees";
import type { GroupView, ListView, OlderRow, SettledRow, ThreadRow } from "../model/view";
import type { DropState, ListModel, ListStore } from "../store/api";

const PLUGIN_ID = "thread-glance";

export interface ModelInfo {
  /** The catalog's display name ("Haiku 4.5"), or the raw id when unknown. */
  model: string;
  reasoningLevel: string;
}

/** What is being dragged, as dnd-kit's active data carries it. */
export type Dragged = { kind: "thread"; thread: DraggedThread } | { kind: "group"; groupId: string };

export interface Commands {
  navigate(): void;
  menuAction(action: RowMenuAction, thread: PluginSidebarThread, sectionId?: string | null): void;
  /** Starts renaming a thread, or stops with null. */
  editTitle(threadId: string | null): void;
  renameThread(threadId: string, title: string): Promise<void>;
  openDetails(threadId: string): void;
  closeDetails(): void;
  /** Opens the thread the details dialog shows. */
  openFromDetails(threadId: string): void;
  loadModel(threadId: string, status: string): Promise<ModelInfo | null>;
  toggleChip(row: ThreadRow): void;
  toggleOlder(row: OlderRow): void;
  toggleSettled(row: SettledRow): void;
  toggleEnvironment(environmentId: string): void;
  newThreadInEnvironment(environmentId: string, projectId: string, sectionId: string | null): void;
  renameEnvironment(environmentId: string, name: string): Promise<void>;
  archiveEnvironment(environmentId: string): void;
  toggleGroup(groupId: string): void;
  newThreadInGroup(groupId: string): void;
  hideGroup(groupId: string): void;
  showGroup(groupId: string): void;
  renameGroup(groupId: string, name: string): Promise<void>;
  removeSection(groupId: string): void;
  markGroupRead(groupId: string): void;
  toggleArchived(): void;
  setCustomizeOpen(open: boolean): void;
  setNewSectionOpen(open: boolean): void;
  createSection(name: string): Promise<void>;
  toggleGroupHidden(groupId: string): void;
  moveGroupInOrder(groupId: string, direction: -1 | 1): void;
  toggleNeedYou(): void;
  markListRead(): void;
  confirm(): void;
  dismissConfirm(): void;
  setMoveQuery(query: string): void;
  closeMove(): void;
  moveUnder(parentThreadId: string | null): void;
  updatePreferences(patch: Partial<Preferences>): void;
  updateClient(patch: Partial<ClientPreferences>): void;
  /** Drop feedback for `dragged` over `target`. */
  dragOver(dragged: Dragged | undefined, target: DropTarget | null): void;
  /** Drops `dragged` on `target`; `placement` says which side of a group header. */
  drop(dragged: Dragged | undefined, target: DropTarget | null, placement: "before" | "after"): void;
  dragCancel(): void;
  reloadPlugin(): void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch (error) {
    toast.error("Couldn't copy", { description: describeError(error) });
  }
}

const fail = (message: string) => (error: unknown) => toast.error(message, { description: describeError(error) });

const NO_DROPS: ReadonlyMap<string, DropState> = new Map();

/** Where each drawn thread is, for drop rules. */
function dropContextOf(model: ListModel, mode: DropContext["mode"]): DropContext & { groupOfThread(id: string): string } {
  const view: ListView = model.view;
  const groupOfThread = new Map<string, string>();
  for (const group of [...view.groups, ...view.more]) {
    for (const row of group.rows) if (row.type === "thread") groupOfThread.set(row.info.thread.id, group.descriptor.id);
  }
  const pinned = view.groups.find((group) => group.descriptor.id === "pinned");
  return {
    mode,
    parentOf: (id) => model.byId.get(id)?.parentThreadId ?? null,
    pinnedOrder: (pinned?.rows ?? []).flatMap((row) => (row.type === "thread" && row.depth === 0 ? [row.info.thread.id] : [])),
    groupOfThread: (id) => groupOfThread.get(id) ?? "threads",
  };
}

export function createCommands(store: ListStore): Commands {
  const edge = () => store.edge;
  const inputs = () => store.getState().inputs;
  const models = new Map<string, Promise<ModelInfo | null>>();
  const catalogs = new Map<string, Promise<readonly { id: string; model: string; displayName: string }[]>>();
  let dropContext: { model: ListModel; context: ReturnType<typeof dropContextOf> } | null = null;

  const groupOf = (groupId: string): GroupView | undefined => store.getState().model?.groupsById.get(groupId);

  const applyToggle = (outcome: ToggleOutcome) => {
    const { targets } = inputs();
    const pruned = outcome.drop === null ? targets : pruneTargets(targets, outcome.drop);
    store.updatePreferences(outcome.patch, pruned === targets ? {} : { targets: pruned });
  };

  const readContext = () => {
    const { activeThreadId, stamps } = inputs();
    return {
      activeThreadId,
      openThreadIds: store.getState().model?.openThreadIds ?? new Set<string>(),
      finishedAt: stamps.finishedAt,
      seenAt: stamps.seenAt,
    };
  };

  /** Marks every unread thread in the trees read, asking first above MARK_ALL_CONFIRM_ABOVE. `where` names them. */
  const markTreesRead = (trees: readonly ThreadTree[], where: string) => {
    const plan = markAllReadPlan(trees, readContext());
    const run = () => {
      if (plan.seen.length > 0) store.markSeen(plan.seen);
      for (const id of plan.read) edge().actions.setRead(id, true).catch(() => undefined);
    };
    if (plan.read.length > MARK_ALL_CONFIRM_ABOVE) {
      store.setUi({
        confirm: {
          title: `Mark ${plan.read.length} threads read?`,
          description: `Every unread thread in ${where}, child threads included, will be marked read.`,
          confirmLabel: "Mark all read",
          run,
        },
      });
    } else {
      run();
    }
  };

  const runDrop = async (action: DropAction) => {
    const { sdk, actions } = edge();
    switch (action.type) {
      case "nest":
        if (action.unpinFirst) await sdk.threads.unpin({ threadId: action.threadId });
        await sdk.threads.update({ threadId: action.threadId, parentThreadId: action.parentThreadId });
        return;
      case "move":
        await sdk.threads.update({
          threadId: action.threadId,
          sectionId: action.sectionId,
          ...(action.detach ? { parentThreadId: null } : {}),
        });
        return;
      case "detach":
        await sdk.threads.update({ threadId: action.threadId, parentThreadId: null });
        return;
      case "pin":
        await actions.setPinned(action.threadId, true);
        return;
      case "unpin":
        await actions.setPinned(action.threadId, false);
        return;
      case "reorder-pinned":
        await sdk.threads.reorderPinned({
          threadId: action.threadId,
          previousThreadId: action.previousThreadId,
          nextThreadId: action.nextThreadId,
        });
        return;
      case "blocked":
      case "unchanged":
        return;
    }
  };

  const currentDropContext = (model: ListModel) => {
    if (dropContext?.model !== model) dropContext = { model, context: dropContextOf(model, inputs().prefs.organizationMode) };
    return dropContext.context;
  };

  const commands: Commands = {
    navigate: () => edge().onNavigate(),

    menuAction(action, thread, sectionId) {
      const { actions, sdk, onNavigate } = edge();
      switch (action) {
        case "open-in-split":
          actions.open(thread.id, { split: true });
          onNavigate();
          return;
        case "copy-link":
          void copyText(new URL(thread.href, window.location.origin).toString(), "Thread link copied");
          return;
        case "copy-id":
          void copyText(thread.id, "Thread ID copied");
          return;
        case "mark-read": {
          const forest = store.getState().model?.forest;
          const plan = forest === undefined ? { read: [thread.id], seen: [] } : markReadPlanFor(thread.id, forest, readContext());
          if (plan.seen.length > 0) store.markSeen(plan.seen);
          for (const id of plan.read) actions.setRead(id, true).catch(fail("Couldn't mark read"));
          return;
        }
        case "mark-unread":
          store.clearSeen([thread.id]);
          actions.setRead(thread.id, false).catch(fail("Couldn't mark unread"));
          return;
        case "pin":
        case "unpin":
          actions.setPinned(thread.id, action === "pin").catch(fail("Couldn't change the pin"));
          return;
        case "move-to-section":
          sdk.threads.update({ threadId: thread.id, sectionId: sectionId ?? null }).catch(fail("Couldn't move the thread"));
          return;
        case "rename":
          store.setUi({ editingId: thread.id });
          return;
        case "details":
          store.setUi({ detailsId: thread.id });
          return;
        case "move":
          store.setUi({ moveQuery: "", moveId: thread.id });
          return;
        case "archive":
          actions.archive(thread.id);
          return;
        case "unarchive":
          sdk.threads.unarchive({ threadId: thread.id }).catch(fail("Couldn't unarchive"));
          return;
        case "delete":
          // Let the menu close before bb's confirmation takes focus.
          setTimeout(() => actions.requestDelete(thread.id), 0);
          return;
      }
    },

    editTitle: (threadId) => store.setUi({ editingId: threadId }),
    renameThread: (threadId, title) => edge().actions.rename(threadId, title),
    openDetails: (threadId) => store.setUi({ detailsId: threadId }),
    closeDetails: () => store.setUi({ detailsId: null }),
    openFromDetails(threadId) {
      store.setUi({ detailsId: null });
      edge().actions.open(threadId);
      edge().onNavigate();
    },

    loadModel(threadId, status) {
      const key = `${threadId}:${status}`;
      let pending = models.get(key);
      if (pending === undefined) {
        const { sdk } = edge();
        const thread = store.getState().model?.byId.get(threadId);
        const providerId = thread?.providerId ?? "";
        // The catalog names the model as the composer does ("Haiku 4.5").
        let catalog = catalogs.get(providerId);
        if (catalog === undefined) {
          catalog = sdk.providers
            .models(thread?.host ? { providerId, hostId: thread.host.id } : { providerId })
            .then(
              (result) => result.models,
              () => [],
            );
          catalogs.set(providerId, catalog);
        }
        const names = catalog;
        pending = sdk.threads.defaultExecutionOptions({ threadId }).then(
          async (options) =>
            options === null ? null : { model: modelDisplayName(options.model, await names), reasoningLevel: options.reasoningLevel },
          () => null,
        );
        models.set(key, pending);
      }
      return pending;
    },

    toggleChip(row) {
      const forest = store.getState().model?.forest;
      if (forest !== undefined) applyToggle(toggleChip(row, inputs().prefs, forest));
    },
    toggleOlder(row) {
      const forest = store.getState().model?.forest;
      if (forest !== undefined) applyToggle(toggleOlder(row, inputs().prefs, forest));
    },
    toggleSettled: (row) => applyToggle(toggleSettled(row, inputs().prefs)),
    toggleEnvironment(environmentId) {
      const { collapsedEnvironments } = inputs().prefs;
      store.updatePreferences({
        collapsedEnvironments: collapsedEnvironments.includes(environmentId)
          ? collapsedEnvironments.filter((id) => id !== environmentId)
          : [...collapsedEnvironments, environmentId],
      });
    },
    newThreadInEnvironment(environmentId, projectId, sectionId) {
      edge().actions.openNewThread({ projectId, environmentId, ...(sectionId ? { sectionId } : {}), focusPrompt: true });
      edge().onNavigate();
    },
    async renameEnvironment(environmentId, name) {
      await edge().sdk.environments.update({ environmentId, name });
    },
    archiveEnvironment(environmentId) {
      edge().sdk.environments.archiveThreads({ environmentId }).catch(fail("Couldn't archive the environment"));
    },

    toggleGroup(groupId) {
      const group = groupOf(groupId);
      const forest = store.getState().model?.forest;
      if (group !== undefined && forest !== undefined) applyToggle(toggleGroup(group, inputs().prefs, forest));
    },
    newThreadInGroup(groupId) {
      const descriptor = groupOf(groupId)?.descriptor;
      if (descriptor === undefined) return;
      edge().actions.openNewThread({
        ...(descriptor.newThreadProjectId ? { projectId: descriptor.newThreadProjectId } : {}),
        ...(descriptor.newThreadSectionId ? { sectionId: descriptor.newThreadSectionId } : {}),
        focusPrompt: true,
      });
      edge().onNavigate();
    },
    hideGroup: (groupId) => store.updatePreferences({ hiddenGroups: [...inputs().prefs.hiddenGroups, groupId] }),
    showGroup: (groupId) => store.updatePreferences({ hiddenGroups: inputs().prefs.hiddenGroups.filter((id) => id !== groupId) }),
    async renameGroup(groupId, name) {
      const descriptor = groupOf(groupId)?.descriptor;
      if (descriptor?.kind === "section") await edge().sdk.threadSections.update({ id: descriptor.entityId!, name });
      else if (descriptor?.kind === "machine") await edge().sdk.hosts.update({ hostId: descriptor.entityId!, name });
    },
    removeSection(groupId) {
      const entityId = groupOf(groupId)?.descriptor.entityId;
      if (entityId == null) return;
      store.setUi({
        confirm: {
          title: "Remove section?",
          description: "Threads in this section will move back to Threads.",
          confirmLabel: "Remove",
          destructive: true,
          run: () => {
            edge().sdk.threadSections.delete({ id: entityId }).catch(fail("Couldn't remove the section"));
          },
        },
      });
    },
    markGroupRead(groupId) {
      const group = groupOf(groupId);
      const forest = store.getState().model?.forest;
      if (group === undefined || forest === undefined) return;
      // Folded roots count too: every tree bucketed in the group.
      markTreesRead(
        group.rootIds.flatMap((id) => forest.treeOf.get(id) ?? []),
        group.descriptor.label,
      );
    },
    toggleArchived: () => store.updatePreferences({ showArchived: !inputs().prefs.showArchived }),
    setCustomizeOpen: (open) => store.setUi({ customizeOpen: open }),
    setNewSectionOpen: (open) => store.setUi({ newSectionOpen: open }),
    async createSection(name) {
      try {
        await edge().sdk.threadSections.create({ name });
      } catch (error) {
        toast.error("Couldn't create the section", { description: describeError(error) });
        throw error;
      }
    },
    toggleGroupHidden(groupId) {
      const { hiddenGroups } = inputs().prefs;
      store.updatePreferences({
        hiddenGroups: hiddenGroups.includes(groupId) ? hiddenGroups.filter((id) => id !== groupId) : [...hiddenGroups, groupId],
      });
    },
    moveGroupInOrder(groupId, direction) {
      const order = store.getState().model?.view.order;
      if (order === undefined) return;
      const neighbour = order[order.indexOf(groupId) + direction];
      if (neighbour === undefined) return;
      store.updatePreferences({
        [ORDER_PREFERENCE[inputs().prefs.organizationMode]]: moveGroup(order, groupId, neighbour, direction < 0 ? "before" : "after"),
      });
    },

    toggleNeedYou: () => store.feed(({ needYouOn }) => ({ needYouOn: !needYouOn })),
    markListRead: () => markTreesRead(store.getState().model?.forest.trees ?? [], "the list"),

    confirm() {
      store.getState().ui.confirm?.run();
      store.setUi({ confirm: null });
    },
    dismissConfirm: () => store.setUi({ confirm: null }),

    setMoveQuery: (query) => store.setUi({ moveQuery: query }),
    closeMove: () => store.setUi({ moveId: null }),
    moveUnder(parentThreadId) {
      const moveId = store.getState().ui.moveId;
      const thread = moveId === null ? undefined : store.getState().model?.byId.get(moveId);
      if (thread === undefined) return;
      const { sdk } = edge();
      const move = async () => {
        if (parentThreadId !== null && (thread.pinnedAt !== null || thread.isPinned)) {
          await sdk.threads.unpin({ threadId: thread.id });
        }
        await sdk.threads.update({ threadId: thread.id, parentThreadId });
      };
      move().catch(fail("Failed to move thread."));
    },

    updatePreferences: (patch) => store.updatePreferences(patch),
    updateClient: (patch) => store.updateClient(patch),

    dragOver(dragged, target) {
      const model = store.getState().model;
      if (dragged?.kind !== "thread" || target === null || target.kind === "group" || model === null) {
        store.setUi({
          dropStates: NO_DROPS,
          dropGroupId: target?.kind === "group" && dragged !== undefined ? target.groupId : null,
        });
        return;
      }
      const outcome = resolveDrop(dragged.thread, target, currentDropContext(model));
      const state: DropState =
        outcome.type === "blocked"
          ? "blocked"
          : outcome.type === "unchanged"
            ? "unchanged"
            : target.zone === "middle"
              ? "valid"
              : target.zone;
      const current = store.getState().ui.dropStates;
      // The same feedback keeps its map, so no row renders for it.
      const same = current.size === 1 && current.get(target.threadId) === state;
      store.setUi({ dropStates: same ? current : new Map([[target.threadId, state]]), dropGroupId: null });
    },

    drop(dragged, target, placement) {
      store.setUi({ dropStates: NO_DROPS, dropGroupId: null });
      const model = store.getState().model;
      if (dragged === undefined || target === null || model === null) return;
      if (dragged.kind === "group") {
        if (target.kind !== "group" || target.groupId === dragged.groupId) return;
        const key = ORDER_PREFERENCE[inputs().prefs.organizationMode];
        store.updatePreferences({ [key]: moveGroup(model.view.order, dragged.groupId, target.groupId, placement) });
        return;
      }
      const action = resolveDrop(dragged.thread, target, currentDropContext(model));
      runDrop(action).catch(fail("Failed to move thread."));
    },

    dragCancel: () => store.setUi({ dropStates: NO_DROPS, dropGroupId: null }),

    reloadPlugin() {
      edge().sdk.plugins.reload({ pluginId: PLUGIN_ID }).catch(() => window.location.reload());
    },
  };
  return commands;
}
