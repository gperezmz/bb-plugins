import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FleetDetailView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { FleetHeader } from "@/shared/fleet-header/FleetHeader";
import { ThreadLink } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { TONE_TEXT } from "@/shared/look/tones";
import { useIsCompactViewport } from "@/shared/use-compact-viewport";
import { useLive } from "@/shared/use-live";
import { Ledger } from "./Ledger";
import { FLEET_TABS, INITIALLY_OPEN, reviewTarget, tabCounts, tabName, type FleetTabName, type WorkSection } from "./model";
import { Notes } from "./Notes";
import { Watching } from "./Watching";
import { Work } from "./Work";

/** A manager thread's Fleet tab: the fleet header over four tabs, Work, Notes, Watching and Ledger. */
export function FleetTab({ threadId }: { threadId: string; params?: unknown }) {
  const api = useDashboardApi();
  const live = useLive(() => api.threadFleet({ threadId }), [api, threadId]);
  return (
    <div className="flex flex-col gap-3 p-1">
      <LiveScreen live={live} what="the Fleet tab">
        {(thread) =>
          thread.kind === "manager" ? (
            <Detail repo={thread.card.repo} managerThreadId={threadId} />
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p>This thread runs no fleet.</p>
              {thread.holder !== null ? (
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

function Detail({ repo, managerThreadId }: { repo: string; managerThreadId: string }) {
  const api = useDashboardApi();
  const touch = useIsCompactViewport();
  const [tab, setTab] = useState<FleetTabName>("work");
  const [open, setOpen] = useState<Readonly<Record<WorkSection, boolean>>>(INITIALLY_OPEN);
  // The Ledger loads when its tab first opens, and stays mounted after, keeping its filters.
  const [ledgerOpened, setLedgerOpened] = useState(false);
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

  useEffect(() => {
    if (scrollTo !== null) document.getElementById(scrollTo.id)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [scrollTo]);

  const choose = (next: FleetTabName) => {
    setTab(next);
    if (next === "ledger") setLedgerOpened(true);
  };

  return (
    <LiveScreen live={live} what="the fleet">
      {(detail) => {
        const counts = tabCounts(detail);
        const review = () => {
          const target = reviewTarget(detail.manifest);
          choose("work");
          if (target.section !== null) setOpen((now) => ({ ...now, [target.section!]: true }));
          if (target.rowId !== null) setScrollTo({ id: target.rowId });
        };
        const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step === 0) return;
          const at = FLEET_TABS.findIndex((entry) => entry.id === tab);
          const next = FLEET_TABS[(at + step + FLEET_TABS.length) % FLEET_TABS.length]!.id;
          choose(next);
          document.getElementById(`fleet-tab-tab-${next}`)?.focus();
        };
        return (
          <>
            <FleetHeader card={detail.card} lastAction={detail.lastAction} now={detail.generatedAt} onReview={review} />
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
