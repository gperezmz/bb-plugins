import { useState } from "react";
import type { FleetsView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { useDashboardApi } from "@/shared/client";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { useIsCompactViewport } from "@/shared/use-compact-viewport";
import { FALLBACK_POLL_MS, refetchEveryView, screenState, useLive } from "@/shared/use-live";
import { Board, PhoneBoard } from "./Board";
import { rememberedFilter, rememberFilter } from "./filter";
import { NO_FLEET_COMMAND, NO_FLEET_TAIL, NO_FLEET_TEXT, NO_FLEET_TITLE, queueFor } from "./model";
import { Queue } from "./Queue";

/**
 * Every fleet's health on the fleet board, and below it the queue of everything that waits on the operator across
 * fleets. A refresh that fails over data already shown leaves the data as it is: the title bar says how old it is.
 */
export function FleetsPage() {
  const api = useDashboardApi();
  const live = useLive(() => api.fleets(), [api]);
  const state = screenState(live);
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {state === "loading" ? <Loading /> : null}
      {state === "failed" ? <CantLoad error={live.error ?? ""} retry={refetchEveryView} /> : null}
      {state === "ready" ? <Ready view={live.data!} refetch={live.refetch} /> : null}
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

function Ready({ view, refetch }: { view: FleetsView; refetch: () => Promise<void> }) {
  const compact = useIsCompactViewport();
  // The fleet the queue is filtered to, by name; a fleet no longer registered filters nothing.
  const [picked, setPickedState] = useState<string | null>(rememberedFilter);
  const setPicked = (fleet: string | null) => {
    rememberFilter(fleet);
    setPickedState(fleet);
  };
  if (view.fleets.length === 0) return <NoFleet />;
  const selected = picked !== null && view.fleets.some((card) => card.repo === picked) ? picked : null;
  const fleets = new Map(view.fleets.map((card) => [card.repo, card]));
  const BoardView = compact ? PhoneBoard : Board;
  return (
    <>
      <BoardView cards={view.fleets} now={view.generatedAt} selected={selected} onSelect={setPicked} />
      <Queue queue={queueFor(view, selected)} now={view.generatedAt} fleets={fleets} filter={selected} onClearFilter={() => setPicked(null)} compact={compact} refetch={refetch} />
    </>
  );
}
