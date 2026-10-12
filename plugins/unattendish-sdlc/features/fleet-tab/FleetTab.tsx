import type { FleetDetailView } from "@/src/fleet/application/views";
import { useDashboardApi } from "@/shared/client";
import { FleetCard } from "@/shared/fleet-card/FleetCard";
import { recentActionText } from "@/shared/inbox/row-model";
import { ThreadLink } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { useLive } from "@/shared/use-live";
import { LedgerSection } from "./Ledger";
import { ManifestSections } from "./ManifestSections";
import { WatchingSections } from "./WatchingSections";

/** A manager thread's Fleet tab: the whole manifest, what is watched and how, the cost, and the ledger. */
export function FleetTab({ threadId }: { threadId: string; params?: unknown }) {
  const api = useDashboardApi();
  const live = useLive(() => api.threadFleet({ threadId }), [api, threadId]);
  return (
    <div className="flex flex-col gap-6 p-1">
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
  const live = useLive(
    async (): Promise<FleetDetailView> => {
      const result = await api.fleetDetail({ repo });
      if (!result.ok) throw new Error(result.reason);
      return result.detail;
    },
    [api, repo],
  );
  return (
    <LiveScreen live={live} what="the fleet">
      {(detail) => (
        <>
          <FleetCard card={detail.card} now={detail.generatedAt} inFleetTab />
          {detail.recentActions.length > 0 ? (
            <ul aria-label="Recently sent" className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              {detail.recentActions.map((action) => (
                <li key={action.id}>{recentActionText(action)}</li>
              ))}
            </ul>
          ) : null}
          <ManifestSections manifest={detail.manifest} managerThreadId={managerThreadId} fleet={repo} now={detail.generatedAt} refetch={live.refetch} />
          <WatchingSections detail={detail} />
          <LedgerSection repo={repo} />
        </>
      )}
    </LiveScreen>
  );
}
