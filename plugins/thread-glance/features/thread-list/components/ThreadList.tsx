// The sidebar list. Its edge feeds bb's hooks and the plugin server into the
// list store and keeps bb's calls behind one reference; everything drawn
// below reads its own part of the store and acts through its commands.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  useRpc,
  useSdk,
  useSidebarSplitLayout,
  useSidebarThreadDraftIds,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { createCommands, type Dragged } from "../commands/commands";
import { useDefaultBranches } from "../data/useDefaultBranches";
import { useIdleReporter } from "../data/useIdleReporter";
import { useNotes } from "../data/useNotes";
import { usePreferences } from "../data/usePreferences";
import { useScheduled } from "../data/useScheduled";
import { useStamps } from "../data/useStamps";
import { useSystemFacts } from "../data/useSystemFacts";
import type { DropTarget } from "../model/drag";
import { moveTargets } from "../model/move";
import { createListStore, type ListStore } from "../store/api";
import {
  ListContext,
  useArchived,
  useBranchedProjectIds,
  useCommands,
  useFocusedThreadId,
  useGroupIds,
  useHasNoThreads,
  useListModel,
  useListStatus,
  useListUi,
  useMoreCounters,
  useMoreIds,
  useShowArchivedOf,
  type ListHandle,
} from "../store/hooks";
import { ConfirmDialog, CustomizeDialog, DetailsDialog, MoveDialog, NewSectionDialog, type CustomizeItem } from "./Dialogs";
import { CounterStrip } from "./glyphs";
import { cancelPendingCards } from "./row-card";
import { useInputModality } from "./input-modality";
import { GroupSection } from "./GroupSection";
import { ThreadDetails } from "./ThreadDetails";
import { ListHeader } from "./ListHeader";

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

function dropTargetOf(event: DragMoveEvent | DragEndEvent): DropTarget | null {
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
}

function draggedOf(event: DragMoveEvent | DragEndEvent): Dragged | undefined {
  return event.active.data.current as Dragged | undefined;
}

export function ThreadList(props: PluginThreadListProps) {
  const [attempt, setAttempt] = useState(0);
  const onRetry = useCallback(() => setAttempt((value) => value + 1), []);
  return <ThreadListEdge key={attempt} {...props} attempt={attempt} onRetry={onRetry} />;
}

/**
 * The list's edge: bb's hooks and props go into the store, bb's calls behind
 * its one reference. It renders on every host update; what it draws does not.
 */
function ThreadListEdge({
  activeThreadId,
  isCompactViewport,
  onNavigate,
  attempt,
  onRetry,
}: PluginThreadListProps & { attempt: number; onRetry(): void }) {
  const [handle] = useState<ListHandle>(() => {
    const store = createListStore();
    return { store, commands: createCommands(store) };
  });
  const { store } = handle;
  const showArchived = useShowArchivedOf(store);
  const sidebar = useSidebarThreads({ experimental_lifecycles: showArchived ? ["active", "archived"] : ["active"] });
  const actions = useThreadActions();
  const sdk = useSdk();
  const rpc = useRpc<RpcContract>();
  const { providers } = useProviders();
  const { providers: environmentProviders } = useEnvironmentProviders();
  const draftIds = useSidebarThreadDraftIds();
  const splitLayout = useSidebarSplitLayout();
  const isIdleReporter = useIdleReporter();
  // bb's calls change identity on every host update; commands read them when they run.
  store.edge = { actions, sdk, rpc, onNavigate, isIdleReporter };
  const host = {
    status: sidebar.status,
    threads: sidebar.threads,
    projects: sidebar.projects,
    sections: sidebar.sections,
    archived: sidebar.experimental_archived,
    providers,
    environmentProviders,
    draftIds,
    splitLayout,
  };
  // The first data is fed before the first draw, so it is drawn at once.
  useState(() => {
    store.feedFocus(activeThreadId, isCompactViewport);
    store.feedHost(host);
  });
  useLayoutEffect(() => store.feedHost(host));
  useLayoutEffect(() => store.feedFocus(activeThreadId, isCompactViewport), [store, activeThreadId, isCompactViewport]);
  useEffect(() => store.attach(), [store]);
  return (
    <ListContext.Provider value={handle}>
      <ServerFeed store={store} />
      <ListBody attempt={attempt} onRetry={onRetry} />
    </ListContext.Provider>
  );
}

/** The plugin server's data, fed into the store. Draws nothing. */
function ServerFeed({ store }: { store: ListStore }) {
  usePreferences(store);
  useStamps(store);
  useScheduled(store);
  useNotes(store);
  useSystemFacts(store);
  useDefaultBranches(store, useBranchedProjectIds());
  return null;
}

const ListBody = memo(function ListBody({ attempt, onRetry }: { attempt: number; onRetry(): void }) {
  const commands = useCommands();
  const status = useListStatus();
  const root = useRef<HTMLDivElement>(null);
  useInputModality(root);
  const activeThreadId = useFocusedThreadId();
  // A navigation drops every pending hover card.
  useEffect(() => cancelPendingCards(), [activeThreadId]);

  if (status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-sm">
        <p className="text-muted-foreground">Threads couldn't load.</p>
        {attempt === 0 ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={commands.reloadPlugin}>
            Reload plugin
          </Button>
        )}
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div role="status" aria-label="Loading threads" className="flex flex-col gap-1 px-2 py-1">
        {[0, 1, 2].map((index) => (
          <div key={index} data-sidebar="navigation-loading-row" className="h-7 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    );
  }
  return (
    <div ref={root} className="flex w-full min-w-0 flex-col px-1.5 pb-2">
      <ListHeader />
      <Groups />
      <ArchivedFooter />
      <ListDialogs />
    </div>
  );
});

/** Every group, the hidden ones in More, inside dnd-kit's context. */
function Groups() {
  const commands = useCommands();
  const empty = useHasNoThreads();
  const groupIds = useGroupIds();
  const moreIds = useMoreIds();
  const moreCounters = useMoreCounters();
  const sensors = useSensors(useSensor(MouseSensor, MOUSE_SENSOR), useSensor(TouchSensor, TOUCH_SENSOR), useSensor(KeyboardSensor));
  const onDragMove = useCallback((event: DragMoveEvent) => commands.dragOver(draggedOf(event), dropTargetOf(event)), [commands]);
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const y = pointerY(event);
      const rect = event.over?.rect;
      const placement = rect !== undefined && y !== null && y > rect.top + rect.height / 2 ? "after" : "before";
      commands.drop(draggedOf(event), dropTargetOf(event), placement);
    },
    [commands],
  );
  // bb's own pinned New thread button covers the empty list.
  if (empty) return <p className="px-3 py-4 text-sm text-muted-foreground">No threads yet.</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={commands.dragCancel}>
      {groupIds.map((id, index) => (
        <GroupSection key={id} groupId={id} gapAbove={index > 0} />
      ))}
      {moreIds.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="sidebar-thread-list-more-trigger"
              aria-label={`More: ${moreIds.length} hidden ${moreIds.length === 1 ? "group" : "groups"}`}
              className="mt-1 flex h-7 w-full items-center gap-1 rounded-md pl-2 pr-1 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <span className="flex-1 font-medium">More</span>
              <CounterStrip counters={moreCounters} />
              <Icon name="ChevronRight" aria-hidden className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="max-h-[70vh] w-72 overflow-y-auto p-1">
            <div data-sidebar-overflow="true" className="flex flex-col">
              {moreIds.map((id, index) => (
                <GroupSection key={id} groupId={id} gapAbove={index > 0} inOverflow />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </DndContext>
  );
}

/** Archived threads' loading state and Show more, while Show archived is on. */
function ArchivedFooter() {
  const archived = useArchived();
  if (archived === null) return null;
  return (
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
  );
}

/** The dialogs the list opens, each drawn from the store's own state. */
function ListDialogs() {
  const commands = useCommands();
  const ui = useListUi();
  const model = useListModel();
  const view = model?.view;
  const customizeItems: CustomizeItem[] = useMemo(() => {
    if (view === undefined) return [];
    const all = new Map([...view.groups, ...view.more].map((group) => [group.descriptor.id, group]));
    return view.order.flatMap((id) => {
      const group = all.get(id);
      if (group === undefined) return [];
      return [{ id, label: group.descriptor.label, hidden: group.hidden, hideable: id !== "pinned" }];
    });
  }, [view]);
  if (model === null) return null;
  const forest = model.forest;
  const details = ui.detailsId === null ? null : (forest.infos.get(ui.detailsId) ?? null);
  const moveThread = ui.moveId === null ? null : (model.byId.get(ui.moveId) ?? null);
  const confirm = ui.confirm;
  return (
    <>
      <CustomizeDialog
        open={ui.customizeOpen}
        items={customizeItems}
        onOpenChange={commands.setCustomizeOpen}
        onToggleHidden={commands.toggleGroupHidden}
        onMove={commands.moveGroupInOrder}
      />
      <NewSectionDialog open={ui.newSectionOpen} onOpenChange={commands.setNewSectionOpen} onCreate={commands.createSection} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "OK"}
        destructive={confirm?.destructive}
        onOpenChange={(open) => !open && commands.dismissConfirm()}
        onConfirm={commands.confirm}
      />
      {details !== null ? (
        <DetailsDialog open title={details.thread.displayTitle} onOpenChange={(open) => !open && commands.closeDetails()}>
          <ThreadDetails
            info={details}
            showPullRequest
            actions={{
              open: () => commands.openFromDetails(details.thread.id),
              toggleRead: () => commands.menuAction(details.unread ? "mark-read" : "mark-unread", details.thread),
            }}
          />
        </DetailsDialog>
      ) : null}
      {moveThread !== null ? (
        <MoveDialog
          open
          title={moveThread.displayTitle}
          targets={moveTargets(moveThread.id, forest, ui.moveQuery)}
          query={ui.moveQuery}
          onQueryChange={commands.setMoveQuery}
          onOpenChange={(open) => !open && commands.closeMove()}
          onMove={commands.moveUnder}
        />
      ) : null}
    </>
  );
}
