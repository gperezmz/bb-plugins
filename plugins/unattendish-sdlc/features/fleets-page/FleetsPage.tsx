import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FleetsView, InboxRowView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { useRowActions, type RowActionState } from "@/shared/inbox/use-row-action";
import {
  composerRequestSeq,
  failsRequest,
  holdComposerRequest,
  releaseComposerRequest,
  requestOnView,
  takeComposerRequest,
  useComposerRequest,
  useComposerRequestSeq,
  type ComposerRequest,
} from "@/shared/composer-request";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { FALLBACK_POLL_MS, refetchEveryView, screenState, useLive } from "@/shared/use-live";
import { Board, NarrowBoard } from "./Board";
import { rememberFilter, useQueueFilter } from "./filter";
import { filterShowing, goneText, NO_FLEET_COMMAND, NO_FLEET_TAIL, NO_FLEET_TEXT, NO_FLEET_TITLE, queueFor, requestedRow, shortNames, type PageLayout, type Tab } from "./model";
import { Queue, type OpenRow } from "./Queue";
import { usePageLayout } from "./use-page-layout";

/**
 * Every fleet's health on the fleet board, and below it the queue of everything that waits on the operator across
 * fleets. A refresh that fails over data already shown leaves the data as it is: the title bar says how old it is.
 *
 * A toast's Answer… or Grant… opens the page at its row's composer. The request is judged on a view fetched after it
 * was made, so the page fetches again from its loading state; one that fails drops the request. The page holds the
 * request while it is mounted, and lets it lapse when it goes first. The queue's tab and
 * what its rows hold in this window, drafts among them, are kept here, above that state, so it leaves them as they were.
 *
 * The page draws its wide or narrow layout by its own width, which bb's sidebar narrows, and redraws as it is resized.
 */
export function FleetsPage() {
  const api = useDashboardApi();
  const request = useComposerRequest();
  // Each view carries the number of the latest request made when it was fetched, so a request is judged only on a
  // view that came after it; a new request refetches from the loading state.
  const requests = useComposerRequestSeq();
  const failedAsOf = useRef(0);
  const live = useLive(() => {
    const asOf = composerRequestSeq();
    return api.fleets().then(
      (view) => ({ view, asOf }),
      (error: unknown) => {
        failedAsOf.current = asOf;
        throw error;
      },
    );
  }, [api, requests]);
  const state = screenState(live);
  const [tab, setTab] = useState<Tab>("all");
  const stateOf = useRowActions(live.refetch);
  useEffect(() => {
    if (request === null) return;
    holdComposerRequest();
    if (state === "failed" && failsRequest(request, failedAsOf.current)) takeComposerRequest(request.seq);
  }, [request, state]);
  // A page that goes before its view loads lets the request lapse, so a later visit does not act on an old click.
  useEffect(() => releaseComposerRequest, []);
  const fresh = requestOnView(request, live.data?.asOf ?? null);
  const page = useRef<HTMLDivElement>(null);
  const layout = usePageLayout(page);
  return (
    <div ref={page} className={cn("flex flex-col gap-6", layout === "wide" ? "p-6" : "p-4")}>
      {state === "loading" ? <Loading /> : null}
      {state === "failed" ? <CantLoad error={live.error ?? ""} retry={refetchEveryView} /> : null}
      {state === "ready" ? <Ready view={live.data!.view} layout={layout} tab={tab} onTab={setTab} stateOf={stateOf} request={fresh} /> : null}
    </div>
  );
}

/** Grey bars in the shape of the board and the queue. */
function Loading() {
  const bar = "h-9 rounded-md bg-muted motion-safe:animate-pulse";
  return (
    <div role="status" aria-label="Loading your fleets" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="h-3 w-48 rounded bg-muted" />
        <div className={bar} />
        <div className={bar} />
        <div className={bar} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="h-6 w-80 rounded bg-muted" />
        <div className={bar} />
        <div className={bar} />
        <div className={bar} />
        <div className={bar} />
      </div>
    </div>
  );
}

function CantLoad({ error, retry }: { error: string; retry: () => Promise<void> }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-16 text-center text-sm">
      <Glyph name={ICONS.cantLoad} className="size-6 text-muted-foreground" />
      <p className="font-medium">Couldn't load your fleets</p>
      <p className="text-destructive-text">{error}</p>
      <p className="text-xs text-muted-foreground">It tries again every {FALLBACK_POLL_MS / 60_000} minute.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
        Try again
      </Button>
    </div>
  );
}

function NoFleet() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-sm">
      <Glyph name={ICONS.fleet} className="size-6 text-muted-foreground" />
      <p className="font-medium">{NO_FLEET_TITLE}</p>
      <p className="text-muted-foreground">
        {NO_FLEET_TEXT} <code className="rounded bg-secondary px-1">{NO_FLEET_COMMAND}</code> {NO_FLEET_TAIL}
      </p>
    </div>
  );
}

interface ReadyProps {
  readonly view: FleetsView;
  readonly layout: PageLayout;
  readonly tab: Tab;
  onTab(tab: Tab): void;
  stateOf(row: InboxRowView): RowActionState;
  readonly request: ComposerRequest | null;
}

function Ready({ view, layout, tab, onTab, stateOf, request }: ReadyProps) {
  const narrow = layout === "narrow";
  // Each board's fold, kept here so a switch of layout finds it as it was left.
  const [quietShown, setQuietShown] = useState(false);
  const [moreShown, setMoreShown] = useState(false);
  // The fleet the queue is filtered to, by name; a fleet no longer registered filters nothing.
  const picked = useQueueFilter();
  const setPicked = rememberFilter;
  const selected = picked !== null && view.fleets.some((card) => card.repo === picked) ? picked : null;
  // The row a toast asked for, for the queue to show with its composer open.
  const [opening, setOpening] = useState<OpenRow | null>(null);
  useEffect(() => {
    if (request === null) return;
    takeComposerRequest(request.seq);
    const row = requestedRow(view, request);
    if (row === null) {
      toast(goneText(request));
      return;
    }
    if (filterShowing(selected, row) !== selected) setPicked(null);
    setOpening({ fleet: row.fleet, rowId: row.id, seq: request.seq });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a request is taken once, on the view it was judged on.
  }, [request]);
  if (view.fleets.length === 0) return <NoFleet />;
  const fleets = new Map(view.fleets.map((card) => [card.repo, card]));
  // The narrow layout names each fleet by its short name, told apart from every fleet registered as of this view.
  const short = narrow ? shortNames(view.fleets.map((card) => card.repo)) : null;
  const nameOf = (fleet: string) => short?.get(fleet) ?? fleet;
  return (
    <>
      {narrow ? (
        <NarrowBoard cards={view.fleets} now={view.generatedAt} selected={selected} onSelect={setPicked} nameOf={nameOf} expanded={moreShown} onExpand={() => setMoreShown(true)} />
      ) : (
        <Board cards={view.fleets} now={view.generatedAt} selected={selected} onSelect={setPicked} showQuiet={quietShown} onShowQuiet={setQuietShown} />
      )}
      <Queue queue={queueFor(view, selected)} now={view.generatedAt} fleets={fleets} filter={selected} onClearFilter={() => setPicked(null)} narrow={narrow} nameOf={nameOf} tab={tab} onTab={onTab} stateOf={stateOf} opening={opening} />
    </>
  );
}
