// The sidebar list: feeds the model from host hooks and the plugin
// server, and hands rows and headers what they need to act.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  experimental_Icon as Icon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useEnvironmentProviders,
  useSdk,
  useSidebarThreadDraftIds,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAutoExpand } from "../data/useAutoExpand";
import { useClientPreferences } from "../data/useClientPreferences";
import { useAttentionHold } from "../data/useAttentionHold";
import { useNow } from "../data/useNow";
import { usePreferences } from "../data/usePreferences";
import { useScheduled } from "../data/useScheduled";
import { useStamps } from "../data/useStamps";
import { resolveDrop, type DraggedThread, type DropAction, type DropTarget } from "../model/drag";
import { buildForest } from "../model/families";
import { moveGroup, ORDER_PREFERENCE } from "../model/groups";
import { MARK_ALL_CONFIRM_ABOVE, type RowMenuAction } from "../model/menu";
import { assignProviderMarks, providerMark } from "../model/provider-mark";
import { isDoneUnseen } from "../model/state";
import { markAllReadPlan, toggleChip, toggleGroup, toggleOlder, type ToggleOutcome } from "../model/toggles";
import { buildListView, type GroupView, type ListView } from "../model/view";
import { shareView } from "../model/share";
import { ListLiveContext, type ListLive, type ModelInfo, type RowController } from "./controller";
import { ConfirmDialog, CustomizeDialog, DetailsDialog, MoveDialog, NewSectionDialog, type CustomizeItem } from "./Dialogs";
import { useNotes } from "../data/useNotes";
import { moveTargets } from "../model/move";
import { modelDisplayName } from "../model/details";
import { groupIdForRoot } from "../model/groups";
import { CounterStrip } from "./glyphs";
import { cancelPendingCards } from "./row-card";
import { GroupSection, AttentionSection, type DropStates, type GroupController } from "./GroupSection";
import type { ProviderDisplay } from "./ProviderBadge";
import { ThreadDetails } from "./ThreadDetails";
import { Toolbar } from "./Toolbar";

const PLUGIN_ID = "thread-glance";

type Confirm = { title: string; description: string; confirmLabel: string; destructive?: boolean; run(): void };

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

// Constant, so dnd-kit's sensors, and with them its context, stay put: new
// options renew the context every draggable row reads, rendering every row.
const MOUSE_SENSOR = { activationConstraint: { distance: 4 } };
const TOUCH_SENSOR = { activationConstraint: { delay: 200, tolerance: 6 } };

/** Prefers a thread row's drop zone over the group that contains it. */
const collision: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind;
  const hits = pointerWithin(args);
  if (kind === "group") return hits.filter((hit) => String(hit.id).startsWith("drop-group:"));
  const rows = hits.filter((hit) => String(hit.id).startsWith("drop-thread:"));
  return rows.length > 0 ? rows : hits;
};

function pointerY(event: DragMoveEvent | DragEndEvent): number | null {
  const activator = event.activatorEvent;
  let start: number | null = null;
  if (activator instanceof MouseEvent) start = activator.clientY;
  else if (typeof TouchEvent !== "undefined" && activator instanceof TouchEvent) start = activator.touches[0]?.clientY ?? null;
  return start === null ? null : start + event.delta.y;
}

export function ThreadList(props: PluginThreadListProps) {
  const [attempt, setAttempt] = useState(0);
  return <ThreadListBody key={attempt} {...props} attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />;
}

function ThreadListBody({
  activeThreadId,
  isCompactViewport,
  onNavigate,
  attempt,
  onRetry,
}: PluginThreadListProps & { attempt: number; onRetry(): void }) {
  const { prefs, hydrated, update } = usePreferences();
  const [client, updateClient] = useClientPreferences();
  const sidebar = useSidebarThreads({ experimental_lifecycles: prefs.threadLifecycles });
  const actions = useThreadActions();
  const sdk = useSdk();
  const { providers } = useProviders();
  const { providers: environmentProviders } = useEnvironmentProviders();
  const draftIds = useSidebarThreadDraftIds();
  const { stamps, markSeen, clearSeen } = useStamps();
  const scheduled = useScheduled();
  const notes = useNotes();
  const nextDeadline = useMemo(() => {
    const future = Object.values(scheduled).filter((at) => at > Date.now());
    return future.length > 0 ? Math.min(...future) : null;
  }, [scheduled]);
  const now = useNow(nextDeadline);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");
  const catalogs = useRef(new Map<string, Promise<readonly { id: string; model: string; displayName: string }[]>>());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dropStates, setDropStates] = useState<DropStates>(() => new Map());
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [defaultBranches, setDefaultBranches] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const branchRequests = useRef(new Set<string>());
  const models = useRef(new Map<string, Promise<ModelInfo | null>>());

  const ready = sidebar.status === "ready";
  const threads = sidebar.threads;
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  const forest = useMemo(
    () =>
      ready
        ? buildForest({
            threads,
            activeThreadId,
            finishedAt: stamps.finishedAt,
            seenAt: stamps.seenAt,
            draftIds,
            scheduled,
            now,
            notes,
            childAttention: prefs.childAttention,
          })
        : null,
    [ready, threads, activeThreadId, stamps.finishedAt, stamps.seenAt, draftIds, scheduled, now, notes, prefs.childAttention],
  );
  const { targets, prune } = useAutoExpand(hydrated ? forest : null, activeThreadId);
  const heldRootId = useAttentionHold(forest, activeThreadId);
  // Rows and groups that did not change keep their objects, so their
  // memoized components skip the render.
  const previousView = useRef<ListView | null>(null);
  const view = useMemo(
    () =>
      forest === null
        ? null
        : shareView(previousView.current, buildListView({
            forest,
            threads,
            projects: sidebar.projects,
            sections: sidebar.sections,
            prefs,
            activeThreadId,
            heldRootId,
            targets,
          })),
    [forest, threads, sidebar.projects, sidebar.sections, prefs, activeThreadId, heldRootId, targets],
  );
  useLayoutEffect(() => {
    previousView.current = view;
  }, [view]);

  // Viewing a child stamps seenAt, on arrival and on leaving, so a child
  // that finishes while you watch doesn't turn unread behind you.
  const previousActive = useRef<string | null>(null);
  useEffect(() => {
    const ids = [previousActive.current, activeThreadId].filter(
      (id): id is string => id !== null && byId.get(id)?.parentThreadId != null,
    );
    previousActive.current = activeThreadId;
    cancelPendingCards();
    if (ids.length > 0) markSeen([...new Set(ids)]);
    // Only the active thread's changes matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Each project's default branch, fetched once per session.
  useEffect(() => {
    if (!prefs.showPullRequests || forest === null) return;
    for (const family of forest.families) {
      const thread = family.root.thread;
      const projectId = thread.projectId;
      if (thread.environment?.branchName == null || thread.host === null) continue;
      if (branchRequests.current.has(projectId)) continue;
      branchRequests.current.add(projectId);
      sdk.projects.branches({ projectId, hostId: thread.host.id, limit: "1" }).then(
        (result) => setDefaultBranches((current) => new Map(current).set(projectId, result.defaultBranch)),
        () => setDefaultBranches((current) => new Map(current).set(projectId, null)),
      );
    }
  }, [prefs.showPullRequests, forest, sdk]);

  const marks = useMemo(() => assignProviderMarks(providers), [providers]);
  // One display per harness, built once: rows compare it by identity.
  const providerDisplay = useMemo(() => {
    const displays = new Map<string, ProviderDisplay>();
    const byProvider = new Map(providers.map((info) => [info.id, info]));
    return (providerId: string): ProviderDisplay => {
      let display = displays.get(providerId);
      if (display === undefined) {
        const info = byProvider.get(providerId);
        display = {
          id: providerId,
          name: info?.displayName ?? providerId,
          provider: info?.logoUrl ? info : null,
          mark: providerMark(providerId, marks),
        };
        displays.set(providerId, display);
      }
      return display;
    };
  }, [providers, marks]);

  const applyToggle = useCallback(
    (outcome: ToggleOutcome) => {
      if (Object.keys(outcome.patch).length > 0) update(outcome.patch);
      if (outcome.drop !== null) prune(outcome.drop);
    },
    [update, prune],
  );

  const runMenuAction = useCallback(
    (action: RowMenuAction, thread: PluginSidebarThread, sectionId?: string | null) => {
      const context = { activeThreadId, finishedAt: stamps.finishedAt, seenAt: stamps.seenAt };
      const fail = (message: string) => (error: unknown) => toast.error(message, { description: describeError(error) });
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
        case "mark-read":
          if (isDoneUnseen(thread, context)) markSeen([thread.id]);
          actions.setRead(thread.id, true).catch(fail("Couldn't mark read"));
          return;
        case "mark-unread":
          clearSeen([thread.id]);
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
          setEditingId(thread.id);
          return;
        case "details":
          setDetailsId(thread.id);
          return;
        case "move":
          setMoveQuery("");
          setMoveId(thread.id);
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
    [actions, activeThreadId, clearSeen, markSeen, onNavigate, sdk, stamps.finishedAt, stamps.seenAt],
  );
  const runMenuActionRef = useRef(runMenuAction);
  useLayoutEffect(() => {
    runMenuActionRef.current = runMenuAction;
  });

  // The committed state for the controllers' callbacks: they read it when
  // called, so the controllers themselves stay put while threads change.
  const latest = useRef({ forest, view, prefs, byId, activeThreadId, stamps });
  useLayoutEffect(() => {
    latest.current = { forest, view, prefs, byId, activeThreadId, stamps };
  });

  const loadModel = useCallback(
    (threadId: string, status: string) => {
      const key = `${threadId}:${status}`;
      let pending = models.current.get(key);
      if (pending === undefined) {
        const thread = latest.current.byId.get(threadId);
        const providerId = thread?.providerId ?? "";
        // The catalog names the model as the composer does ("Haiku 4.5").
        let catalog = catalogs.current.get(providerId);
        if (catalog === undefined) {
          catalog = sdk.providers
            .models(thread?.host ? { providerId, hostId: thread.host.id } : { providerId })
            .then(
              (result) => result.models,
              () => [],
            );
          catalogs.current.set(providerId, catalog);
        }
        const names = catalog;
        pending = sdk.threads.defaultExecutionOptions({ threadId }).then(
          async (options) =>
            options === null
              ? null
              : { model: modelDisplayName(options.model, await names), reasoningLevel: options.reasoningLevel },
          () => null,
        );
        models.current.set(key, pending);
      }
      return pending;
    },
    [sdk],
  );

  const multiHost = view?.multiHost ?? false;
  const built = forest !== null && view !== null;
  const rowController: RowController | null = useMemo(() => {
    if (!built) return null;
    return {
      compact: isCompactViewport,
      comfortable: client.density === "comfortable",
      setEditingId,
      showPullRequests: prefs.showPullRequests,
      harnessIcon: prefs.harnessIcon,
      defaultBranchOf: (thread) =>
        defaultBranches.has(thread.projectId) ? defaultBranches.get(thread.projectId) ?? null : undefined,
      multiHost,
      provider: providerDisplay,
      sections: sidebar.sections,
      mode: prefs.organizationMode,
      onNavigate,
      onToggleChip: (row) => {
        const { prefs, forest } = latest.current;
        applyToggle(toggleChip(row, prefs, forest!));
      },
      onToggleOlder: (row) => {
        const { prefs, forest, view } = latest.current;
        const group = view!.groups.find((candidate) => candidate.descriptor.id === row.scopeId) ?? null;
        applyToggle(toggleOlder(row, prefs, group, forest!));
      },
      onToggleEnvironment: (environmentId) => {
        const { collapsedEnvironments } = latest.current.prefs;
        update({
          collapsedEnvironments: collapsedEnvironments.includes(environmentId)
            ? collapsedEnvironments.filter((id) => id !== environmentId)
            : [...collapsedEnvironments, environmentId],
        });
      },
      onMenuAction: (action, thread, sectionId) => runMenuActionRef.current(action, thread, sectionId),
      onRename: (threadId, title) => actions.rename(threadId, title),
      loadModel,
      openDetails: setDetailsId,
      onNewThreadInEnvironment: (environmentId, projectId, sectionId) => {
        actions.openNewThread({ projectId, environmentId, ...(sectionId ? { sectionId } : {}), focusPrompt: true });
        onNavigate();
      },
      onRenameEnvironment: async (environmentId, name) => {
        await sdk.environments.update({ environmentId, name });
      },
      onArchiveEnvironment: (environmentId) => {
        sdk.environments.archiveThreads({ environmentId }).catch((error: unknown) =>
          toast.error("Couldn't archive the environment", { description: describeError(error) }),
        );
      },
    };
  }, [
    built,
    isCompactViewport,
    client.density,
    prefs.showPullRequests,
    prefs.harnessIcon,
    prefs.organizationMode,
    defaultBranches,
    multiHost,
    providerDisplay,
    sidebar.sections,
    onNavigate,
    applyToggle,
    update,
    actions,
    sdk,
    loadModel,
  ]);

  const live: ListLive = useMemo(
    () => ({ now, stamps, notes, familyOf: (threadId) => forest?.familyOf.get(threadId) }),
    [now, stamps, notes, forest],
  );

  const activeGroupId = useMemo(() => {
    const family = activeThreadId === null || forest === null ? undefined : forest.familyOf.get(activeThreadId);
    return family === undefined
      ? null
      : groupIdForRoot(family.root.thread, { mode: prefs.organizationMode, projects: sidebar.projects });
  }, [activeThreadId, forest, prefs.organizationMode, sidebar.projects]);
  const showArchived = prefs.threadLifecycles.includes("archived");

  const groupController: GroupController | null = useMemo(() => {
    if (!built) return null;
    const markAll = (group: GroupView) => {
      const { forest, activeThreadId, stamps } = latest.current;
      // Folded roots count too: every family bucketed in the group.
      const families = group.rootIds.flatMap((id) => forest!.familyOf.get(id) ?? []);
      const plan = markAllReadPlan(families, {
        activeThreadId,
        finishedAt: stamps.finishedAt,
        seenAt: stamps.seenAt,
      });
      const run = () => {
        if (plan.seen.length > 0) markSeen(plan.seen);
        for (const id of plan.read) actions.setRead(id, true).catch(() => undefined);
      };
      if (plan.read.length === 0) {
        toast(`Nothing unread in ${group.descriptor.label}`);
      } else if (plan.read.length > MARK_ALL_CONFIRM_ABOVE) {
        setConfirm({
          title: `Mark ${plan.read.length} threads read?`,
          description: `Every unread thread in ${group.descriptor.label}, child threads included, will be marked read.`,
          confirmLabel: "Mark all read",
          run,
        });
      } else {
        run();
      }
    };
    return {
      compact: isCompactViewport,
      activeGroupId,
      showArchived,
      onToggleArchived: () =>
        update({
          threadLifecycles: latest.current.prefs.threadLifecycles.includes("archived") ? ["active"] : ["active", "archived"],
        }),
      canCreateSections: prefs.organizationMode === "chronological",
      onToggleCollapse: (group) => {
        const { prefs, forest } = latest.current;
        applyToggle(toggleGroup(group, prefs, forest!));
      },
      onNewThread: (group) => {
        const descriptor = group.descriptor;
        actions.openNewThread({
          ...(descriptor.newThreadProjectId ? { projectId: descriptor.newThreadProjectId } : {}),
          ...(descriptor.newThreadSectionId ? { sectionId: descriptor.newThreadSectionId } : {}),
          focusPrompt: true,
        });
        onNavigate();
      },
      onHide: (group) => update({ hiddenGroups: [...latest.current.prefs.hiddenGroups, group.descriptor.id] }),
      onShow: (group) =>
        update({ hiddenGroups: latest.current.prefs.hiddenGroups.filter((id) => id !== group.descriptor.id) }),
      onCustomize: () => setCustomizeOpen(true),
      onRename: async (group, name) => {
        if (group.descriptor.kind === "section") {
          await sdk.threadSections.update({ id: group.descriptor.entityId!, name });
        } else if (group.descriptor.kind === "machine") {
          await sdk.hosts.update({ hostId: group.descriptor.entityId!, name });
        }
      },
      onRemove: (group) =>
        setConfirm({
          title: "Remove section?",
          description: "Threads in this section will move back to Threads.",
          confirmLabel: "Remove",
          destructive: true,
          run: () => {
            sdk.threadSections
              .delete({ id: group.descriptor.entityId! })
              .catch((error: unknown) => toast.error("Couldn't remove the section", { description: describeError(error) }));
          },
        }),
      onMarkAllRead: markAll,
      onNewSection: () => setNewSectionOpen(true),
    };
  }, [built, isCompactViewport, activeGroupId, showArchived, prefs.organizationMode, applyToggle, actions, onNavigate, update, sdk, markSeen]);

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR),
    useSensor(TouchSensor, TOUCH_SENSOR),
    useSensor(KeyboardSensor),
  );

  const dropTargetOf = useCallback((event: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const over = event.over;
    if (over === null) return null;
    const data = over.data.current as { kind: string; threadId?: string; groupId: string; inPinned?: boolean } | undefined;
    if (data === undefined) return null;
    if (data.kind === "group") return { kind: "group", groupId: data.groupId };
    const y = pointerY(event);
    const rect = over.rect;
    const ratio = y === null ? 0.5 : (y - rect.top) / Math.max(rect.height, 1);
    const zone = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "middle";
    return { kind: "thread", threadId: data.threadId!, zone, inPinned: data.inPinned ?? false };
  }, []);

  const dropContext = useMemo(() => {
    // A row in Needs attention drops as it would in its home group.
    const groupOfThread = new Map<string, string>(Object.entries(view?.attention?.homeGroupIds ?? {}));
    for (const group of [...(view?.groups ?? []), ...(view?.more ?? [])]) {
      for (const row of group.rows) if (row.type === "thread") groupOfThread.set(row.info.thread.id, group.descriptor.id);
    }
    const pinned = view?.groups.find((group) => group.descriptor.id === "pinned");
    return {
      mode: prefs.organizationMode,
      parentOf: (id: string) => byId.get(id)?.parentThreadId ?? null,
      pinnedOrder: (pinned?.rows ?? []).flatMap((row) => (row.type === "thread" && row.depth === 0 ? [row.info.thread.id] : [])),
      groupOfThread: (id: string) => groupOfThread.get(id) ?? "threads",
    };
  }, [view, prefs.organizationMode, byId]);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const active = event.active.data.current as { kind: string; thread?: DraggedThread } | undefined;
      const target = dropTargetOf(event);
      if (active?.kind !== "thread" || target === null) {
        setDropStates(new Map());
        setDropGroupId(active?.kind === "group" && target?.kind === "group" ? target.groupId : null);
        return;
      }
      if (target.kind === "group") {
        setDropStates(new Map());
        setDropGroupId(target.groupId);
        return;
      }
      setDropGroupId(null);
      const outcome = resolveDrop(active.thread!, target, dropContext);
      const state =
        outcome.type === "blocked"
          ? "blocked"
          : outcome.type === "unchanged"
            ? "unchanged"
            : target.zone === "middle"
              ? "valid"
              : target.zone;
      setDropStates(new Map([[target.threadId, state]]));
    },
    [dropTargetOf, dropContext],
  );

  const runDrop = useCallback(
    async (action: DropAction) => {
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
    },
    [sdk, actions],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDropStates(new Map());
      setDropGroupId(null);
      const active = event.active.data.current as { kind: string; thread?: DraggedThread; groupId?: string } | undefined;
      const target = dropTargetOf(event);
      if (active === undefined || target === null || view === null) return;
      if (active.kind === "group") {
        if (target.kind !== "group" || target.groupId === active.groupId) return;
        const rect = event.over!.rect;
        const y = pointerY(event);
        const placement = y !== null && y > rect.top + rect.height / 2 ? "after" : "before";
        const key = ORDER_PREFERENCE[prefs.organizationMode];
        update({ [key]: moveGroup(view.order, active.groupId!, target.groupId, placement) });
        return;
      }
      const action = resolveDrop(active.thread!, target, dropContext);
      runDrop(action).catch((error: unknown) => toast.error("Failed to move thread.", { description: describeError(error) }));
    },
    [dropTargetOf, view, prefs.organizationMode, update, dropContext, runDrop],
  );

  const onDragCancel = useCallback(() => setDropStates(new Map()), []);

  const customizeItems: CustomizeItem[] = useMemo(() => {
    if (view === null) return [];
    const all = new Map([...view.groups, ...view.more].map((group) => [group.descriptor.id, group]));
    return view.order.flatMap((id) => {
      const group = all.get(id);
      if (group === undefined) return [];
      return [{ id, label: group.descriptor.label, hidden: group.hidden, hideable: id !== "pinned" }];
    });
  }, [view]);

  // States.
  if (sidebar.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-sm">
        <p className="text-muted-foreground">Threads couldn't load.</p>
        {attempt === 0 ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              sdk.plugins.reload({ pluginId: PLUGIN_ID }).catch(() => window.location.reload());
            }}
          >
            Reload plugin
          </Button>
        )}
      </div>
    );
  }
  if (sidebar.status === "loading" || !hydrated || view === null || rowController === null || groupController === null) {
    return (
      <div role="status" aria-label="Loading threads" className="flex flex-col gap-1 px-2 py-1">
        {[0, 1, 2].map((index) => (
          <div key={index} data-sidebar="navigation-loading-row" className="h-7 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    );
  }

  const archived = sidebar.experimental_archived;
  const details = detailsId === null ? null : forest?.infos.get(detailsId) ?? null;
  const moveThread = moveId === null ? null : byId.get(moveId) ?? null;

  return (
    <ListLiveContext.Provider value={live}>
      <div className="flex w-full min-w-0 flex-col px-1.5 pb-2">
        <Toolbar prefs={prefs} client={client} onPrefs={update} onClient={updateClient} />
        {threads.length === 0 ? (
          // bb's own pinned New thread button covers the empty list.
          <p className="px-3 py-4 text-sm text-muted-foreground">No threads yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={collision} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
            {view.attention !== null ? (
              <AttentionSection
                view={view.attention}
                rowController={rowController}
                environmentProviders={environmentProviders}
                dropStates={dropStates}
                activeThreadId={activeThreadId}
                editingId={editingId}
                now={now}
                stamps={stamps}
              />
            ) : null}
            {view.groups.map((group) => (
              <GroupSection
                key={group.descriptor.id}
                group={group}
                rowController={rowController}
                groupController={groupController}
                environmentProviders={environmentProviders}
                dropStates={dropStates}
                dropTargetGroupId={dropGroupId}
                activeThreadId={activeThreadId}
                editingId={editingId}
                now={now}
                stamps={stamps}
              />
            ))}
            {view.more.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="sidebar-thread-list-more-trigger"
                    aria-label={`More: ${view.more.length} hidden ${view.more.length === 1 ? "group" : "groups"}`}
                    className="mt-1 flex h-7 w-full items-center gap-1 rounded-md pl-2 pr-1 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  >
                    <span className="flex-1 font-medium">More</span>
                    <CounterStrip counters={view.moreCounters} />
                    <Icon name="ChevronRight" aria-hidden className="size-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="end" className="max-h-[70vh] w-72 overflow-y-auto p-1">
                  <div data-sidebar-overflow="true" className="flex flex-col">
                    {view.more.map((group) => (
                      <GroupSection
                        key={group.descriptor.id}
                        group={group}
                        rowController={rowController}
                        groupController={groupController}
                        environmentProviders={environmentProviders}
                        dropStates={dropStates}
                        dropTargetGroupId={dropGroupId}
                        activeThreadId={activeThreadId}
                        editingId={editingId}
                        now={now}
                        stamps={stamps}
                        inOverflow
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
          </DndContext>
        )}
        {archived !== null ? (
          <div className="flex flex-col items-start gap-1 px-2 pt-2">
            {archived.status === "loading" ? (
              <p role="status" className="text-xs text-muted-foreground">
                Loading archived threads…
              </p>
            ) : archived.status === "error" ? (
              <p role="status" className="text-xs text-muted-foreground">
                Archived threads unavailable
              </p>
            ) : null}
            {archived.hasNextPage || archived.isFetchNextPageError ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Load more archived threads"
                disabled={archived.isFetchingNextPage}
                className={cn("h-7 text-xs text-muted-foreground")}
                onClick={() => void archived.fetchNextPage()}
              >
                {archived.isFetchingNextPage ? "Loading…" : archived.isFetchNextPageError ? "Retry loading" : "Show more"}
              </Button>
            ) : null}
          </div>
        ) : null}
        <CustomizeDialog
          open={customizeOpen}
          items={customizeItems}
          onOpenChange={setCustomizeOpen}
          onToggleHidden={(id) =>
            update({
              hiddenGroups: prefs.hiddenGroups.includes(id)
                ? prefs.hiddenGroups.filter((candidate) => candidate !== id)
                : [...prefs.hiddenGroups, id],
            })
          }
          onMove={(id, direction) => {
            const index = view.order.indexOf(id);
            const neighbour = view.order[index + direction];
            if (neighbour === undefined) return;
            update({
              [ORDER_PREFERENCE[prefs.organizationMode]]: moveGroup(view.order, id, neighbour, direction < 0 ? "before" : "after"),
            });
          }}
        />
        <NewSectionDialog
          open={newSectionOpen}
          onOpenChange={setNewSectionOpen}
          onCreate={async (name) => {
            try {
              await sdk.threadSections.create({ name });
            } catch (error) {
              toast.error("Couldn't create the section", { description: describeError(error) });
              throw error;
            }
          }}
        />
        <ConfirmDialog
          open={confirm !== null}
          title={confirm?.title ?? ""}
          description={confirm?.description ?? ""}
          confirmLabel={confirm?.confirmLabel ?? "OK"}
          destructive={confirm?.destructive}
          onOpenChange={(open) => !open && setConfirm(null)}
          onConfirm={() => {
            confirm?.run();
            setConfirm(null);
          }}
        />
        {details !== null && details !== undefined ? (
          <DetailsDialog open title={details.thread.displayTitle} onOpenChange={(open) => !open && setDetailsId(null)}>
            <ThreadDetails
              info={details}
              controller={rowController}
              showPullRequest={prefs.showPullRequests}
              actions={{
                open: () => {
                  setDetailsId(null);
                  actions.open(details.thread.id);
                  onNavigate();
                },
                toggleRead: () => runMenuAction(details.unread ? "mark-read" : "mark-unread", details.thread),
              }}
            />
          </DetailsDialog>
        ) : null}
        {moveThread !== null && forest !== null ? (
          <MoveDialog
            open
            title={moveThread.displayTitle}
            targets={moveTargets(moveThread.id, forest, moveQuery)}
            query={moveQuery}
            onQueryChange={setMoveQuery}
            onOpenChange={(open) => !open && setMoveId(null)}
            onMove={(parentThreadId) => {
              const move = async () => {
                if (parentThreadId !== null && (moveThread.pinnedAt !== null || moveThread.isPinned)) {
                  await sdk.threads.unpin({ threadId: moveThread.id });
                }
                await sdk.threads.update({ threadId: moveThread.id, parentThreadId });
              };
              move().catch((error: unknown) => toast.error("Failed to move thread.", { description: describeError(error) }));
            }}
          />
        ) : null}
      </div>
    </ListLiveContext.Provider>
  );
}
