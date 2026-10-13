import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FleetDetailView, HeldFleetView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { FleetHeader } from "@/shared/fleet-header/FleetHeader";
import { ThreadLink } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { takeReview, useReviewRequested } from "@/shared/review-request";
import { showFleet, useShownFleet } from "@/shared/shown-fleet";
import { shownFleet, threadFleetOrder } from "@/shared/thread-fleets";
import { TONE_TEXT } from "@/shared/look/tones";
import { useIsCompactViewport } from "@/shared/use-compact-viewport";
import { useLive } from "@/shared/use-live";
import { Ledger } from "./Ledger";
import { FLEET_TABS, INITIALLY_OPEN, nextTab, reviewTarget, switcherEntries, tabCounts, tabName, type FleetTabName, type SwitcherEntry, type WorkSection } from "./model";
import { Notes } from "./Notes";
import { Switcher } from "./Switcher";
import { Watching } from "./Watching";
import { Work } from "./Work";

/**
 * A manager thread's Fleet tab: one of the fleets the thread holds, its header over four tabs, Work, Notes, Watching and
 * Ledger. With more than one, the header's fleet name switches between them.
 */
export function FleetTab({ threadId }: { threadId: string; params?: unknown }) {
  const api = useDashboardApi();
  const live = useLive(() => api.threadFleet({ threadId }), [api, threadId]);
  return (
    <div className="flex flex-col gap-3 p-1">
      <LiveScreen live={live} what="the Fleet tab">
        {(thread) =>
          thread.kind === "manager" && thread.fleets.length > 0 ? (
            <Shown fleets={thread.fleets} now={thread.generatedAt} managerThreadId={threadId} />
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p>This thread runs no fleet.</p>
              {thread.kind === "none" && thread.holder !== null ? (
                <p className="text-muted-foreground">
                  {thread.holder.repo} is run by <ThreadLink threadId={thread.holder.managerThreadId}>its manager thread</ThreadLink>.
                </p>
              ) : null}
            </div>
          )
        }
      </LiveScreen>
    </div>
  );
}

/**
 * The fleet the tab shows: the one remembered for the thread where it still holds it, else the first in order, which is
 * then remembered, so the tab stays on it as the counts change.
 */
function Shown({ fleets, now, managerThreadId }: { fleets: readonly HeldFleetView[]; now: string; managerThreadId: string }) {
  const wanted = useShownFleet(managerThreadId);
  const [tab, setTab] = useState<FleetTabName>("work");
  const ordered = threadFleetOrder(fleets, now);
  const repo = shownFleet(ordered, wanted)!.card.repo;
  useEffect(() => {
    if (wanted !== repo) showFleet(managerThreadId, repo);
  }, [wanted, repo, managerThreadId]);
  const entries = ordered.length > 1 ? switcherEntries(ordered.map((held) => held.card), now) : null;
  // Keyed by the fleet, so the folds, the scroll target and the Ledger start afresh for each; the tab chosen carries over.
  return <Detail key={repo} repo={repo} managerThreadId={managerThreadId} entries={entries} tab={tab} setTab={setTab} />;
}

function Detail({ repo, managerThreadId, entries, tab, setTab }: { repo: string; managerThreadId: string; entries: readonly SwitcherEntry[] | null; tab: FleetTabName; setTab(tab: FleetTabName): void }) {
  const api = useDashboardApi();
  const touch = useIsCompactViewport();
  const [open, setOpen] = useState<Readonly<Record<WorkSection, boolean>>>(INITIALLY_OPEN);
  // The Ledger loads when its tab first opens, and stays mounted after, keeping its filters.
  const [ledgerOpened, setLedgerOpened] = useState(tab === "ledger");
  // A new object for each Review, so a second Review of the same row scrolls to it again.
  const [scrollTo, setScrollTo] = useState<{ readonly id: string } | null>(null);
  const live = useLive(
    async (): Promise<FleetDetailView> => {
      const result = await api.fleetDetail({ repo });
      if (!result.ok) throw new Error(result.reason);
      return result.detail;
    },
    [api, repo],
  );

  const choose = (next: FleetTabName) => {
    setTab(next);
    if (next === "ledger") setLedgerOpened(true);
  };
  const review = (detail: FleetDetailView) => {
    const target = reviewTarget(detail.manifest);
    choose("work");
    if (target.section !== null) setOpen((now) => ({ ...now, [target.section!]: true }));
    if (target.rowId !== null) setScrollTo({ id: target.rowId });
  };

  // Review pressed for this fleet outside the tab, taken once the fleet has loaded.
  const reviewRequested = useReviewRequested(managerThreadId, repo);
  useEffect(() => {
    if (reviewRequested && live.data !== null && takeReview(managerThreadId, repo)) review(live.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a request is taken once, when it and the fleet are both there.
  }, [reviewRequested, live.data, managerThreadId, repo]);

  useEffect(() => {
    if (scrollTo !== null) document.getElementById(scrollTo.id)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [scrollTo]);

  return (
    <LiveScreen live={live} what="the fleet">
      {(detail) => {
        const counts = tabCounts(detail);
        const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
          const next = nextTab(tab, event.key);
          if (next === null) return;
          choose(next);
          document.getElementById(`fleet-tab-tab-${next}`)?.focus();
        };
        return (
          <>
            <FleetHeader
              card={detail.card}
              lastAction={detail.lastAction}
              now={detail.generatedAt}
              onReview={() => review(detail)}
              name={entries !== null ? <Switcher entries={entries} shown={repo} onPick={(next) => showFleet(managerThreadId, next)} /> : undefined}
            />
            <div role="tablist" aria-label="Fleet" onKeyDown={onKey} className="sticky top-0 z-10 -mx-1 flex gap-1 border-b border-border bg-background px-1">
              {FLEET_TABS.map((entry) => {
                const count = counts[entry.id];
                const selected = tab === entry.id;
                return (
                  <button
                    key={entry.id}
                    id={`fleet-tab-tab-${entry.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`fleet-tab-panel-${entry.id}`}
                    aria-label={tabName(entry.id, count)}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => choose(entry.id)}
                    className={cn(
                      "-mb-px flex items-center gap-1 border-b-2 px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      selected ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {entry.label}
                    {count.count !== null ? <span className={cn("tabular-nums", count.tone === "grey" ? "text-muted-foreground" : cn(TONE_TEXT[count.tone], "font-semibold"))}>{count.count}</span> : null}
                  </button>
                );
              })}
            </div>
            <Panel id="work" tab={tab}>
              <Work detail={detail} managerThreadId={managerThreadId} open={open} onToggle={(section) => setOpen((now) => ({ ...now, [section]: !now[section] }))} touch={touch} refetch={live.refetch} />
            </Panel>
            <Panel id="notes" tab={tab}>
              <Notes manifest={detail.manifest} />
            </Panel>
            <Panel id="watching" tab={tab}>
              <Watching detail={detail} />
            </Panel>
            <Panel id="ledger" tab={tab}>
              {ledgerOpened ? <Ledger repo={repo} /> : null}
            </Panel>
          </>
        );
      }}
    </LiveScreen>
  );
}

/** A tab's panel, kept mounted while another tab shows, so each keeps its folds and filters. */
function Panel({ id, tab, children }: { id: FleetTabName; tab: FleetTabName; children: ReactNode }) {
  return (
    <div id={`fleet-tab-panel-${id}`} role="tabpanel" aria-labelledby={`fleet-tab-tab-${id}`} hidden={tab !== id}>
      {children}
    </div>
  );
}
