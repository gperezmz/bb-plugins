// The sidebar list. Its edge feeds bb's hooks and the plugin server into the
// list store and keeps bb's calls behind one reference; everything drawn
// below reads its own part of the store and acts through its commands.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useSidebarThreadSplit as useThreadSplit,
  useEnvironmentProviders,
  useRpc,
  useSdk,
  useSidebarSplitLayout,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatuses,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createCommands } from "../commands/commands";
import { useIdleReporter } from "../data/useIdleReporter";
import { lookUpDefaultBranches, lookUpSystem } from "../sync";
import { ListSyncKeeper } from "../sync/SyncKeeper";
import { moveTargets } from "../model/move";
import { createListStore } from "../store/api";
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
  useProbeId,
  useShowArchivedOf,
  type ListHandle,
} from "../store/hooks";
import { ConfirmDialog, CustomizeDialog, DetailsDialog, MoveDialog, NewSectionDialog, type CustomizeItem } from "./Dialogs";
import { DragLayer } from "./drag/DragLayer";
import { CounterStrip } from "./glyphs";
import { useInputModality } from "./input-modality";
import { ListHeader } from "./ListHeader";
import { CardHost } from "./overlays/CardHost";
import { ContextMenuHost } from "./overlays/ContextMenuHost";
import { GroupMenuHost } from "./overlays/GroupMenuHost";
import { createOverlays, OverlaysContext, useOverlays, type Overlays } from "./overlays/overlays";
import { RowMenuHost } from "./overlays/RowMenuHost";
import { ThreadDetails } from "./ThreadDetails";
import { VirtualGroups } from "./virtual/VirtualGroups";

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
  const [handle] = useState<ListHandle & { overlays: Overlays }>(() => {
    const store = createListStore();
    const commands = createCommands(store);
    return { store, commands, overlays: createOverlays(store, commands) };
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
  const rowStatuses = useSidebarThreadRowStatuses();
  const splitLayout = useSidebarSplitLayout();
  const isIdleReporter = useIdleReporter();
  const host = {
    status: sidebar.status,
    threads: sidebar.threads,
    projects: sidebar.projects,
    sections: sidebar.sections,
    archived: sidebar.experimental_archived,
    providers,
    environmentProviders,
    draftIds,
    rowStatuses,
    splitLayout,
  };
  // The first data is fed before the first draw, so it is drawn at once.
  useState(() => {
    store.feedFocus(activeThreadId, isCompactViewport);
    store.feedHost(host);
  });
  // bb's calls change identity on every host update; commands read them when they run.
  useLayoutEffect(() => {
    store.edge = { actions, sdk, rpc, onNavigate, isIdleReporter };
  });
  useLayoutEffect(() => store.feedHost(host));
  useLayoutEffect(() => store.feedFocus(activeThreadId, isCompactViewport), [store, activeThreadId, isCompactViewport]);
  useEffect(() => store.attach(), [store]);
  return (
    <ListContext.Provider value={handle}>
      <OverlaysContext.Provider value={handle.overlays}>
        <ListSyncKeeper />
        <Lookups />
        <ListBody attempt={attempt} onRetry={onRetry} />
      </OverlaysContext.Provider>
    </ListContext.Provider>
  );
}

/** Asks bb what the list shows of it and has not asked in the plugin's lifetime. Draws nothing. */
function Lookups() {
  const sdk = useSdk();
  const projectIds = useBranchedProjectIds();
  useEffect(() => lookUpSystem(sdk), [sdk]);
  useEffect(() => lookUpDefaultBranches(sdk, projectIds), [sdk, projectIds]);
  return null;
}

const ListBody = memo(function ListBody({ attempt, onRetry }: { attempt: number; onRetry(): void }) {
  const commands = useCommands();
  const status = useListStatus();
  const root = useRef<HTMLDivElement>(null);
  useInputModality(root);
  const overlays = useOverlays();
  const activeThreadId = useFocusedThreadId();
  useEffect(() => overlays.card.attach(), [overlays]);
  // A navigation drops every pending hover card.
  useEffect(() => overlays.card.cancelPending(), [overlays, activeThreadId]);

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
      <DragLayer>
        <Groups />
      </DragLayer>
      <ArchivedFooter />
      <ListDialogs />
      <RowMenuHost />
      <GroupMenuHost />
      <ContextMenuHost />
      <CardHost />
      <SplitProbe />
    </div>
  );
});

/**
 * bb's drag-to-split and "open in split" for the whole list: one call of its
 * hook, for the row under the pointer, which each row's press is handed to.
 */
function SplitProbe() {
  const commands = useCommands();
  const overlays = useOverlays();
  const threadId = useProbeId();
  const split = useThreadSplit(threadId ?? "");
  useLayoutEffect(() => overlays.setSplit(threadId, split));
  useLayoutEffect(() => commands.setSplitAvailable(split.isAvailable), [commands, split.isAvailable]);
  return null;
}

/** Every group, the hidden ones in More. */
function Groups() {
  const empty = useHasNoThreads();
  const groupIds = useGroupIds();
  const moreIds = useMoreIds();
  const moreCounters = useMoreCounters();
  // bb's own pinned New thread button covers the empty list.
  if (empty) return <p className="px-3 py-4 text-sm text-muted-foreground">No threads yet.</p>;
  return (
    <>
      <VirtualGroups groupIds={groupIds} />
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
              <VirtualGroups groupIds={moreIds} inOverflow />
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
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
          className="h-7 text-xs text-muted-foreground"
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
  if (model === null) return null;
  const view = model.view;
  const all = new Map([...view.groups, ...view.more].map((group) => [group.descriptor.id, group]));
  const customizeItems: CustomizeItem[] = view.order.flatMap((id) => {
    const group = all.get(id);
    if (group === undefined) return [];
    return [{ id, label: group.descriptor.label, hidden: group.hidden, hideable: id !== "pinned" }];
  });
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
        <DetailsDialog title={details.thread.displayTitle} onOpenChange={(open) => !open && commands.closeDetails()}>
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
