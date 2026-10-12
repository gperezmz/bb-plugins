import type { FleetsView } from "@/src/fleet/application/views";
import { useDashboardApi } from "@/shared/client";
import { openConnect } from "@/shared/connect/requests";
import { FleetCard } from "@/shared/fleet-card/FleetCard";
import { InboxTable } from "@/shared/inbox/InboxTable";
import { recentActionText } from "@/shared/inbox/row-model";
import { itemTitle } from "@/shared/item-title";
import { ItemLink, LINK_CLASS } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { useLive } from "@/shared/use-live";
import { landedDate, NO_FLEET_COMMAND, NO_FLEET_TAIL, NO_FLEET_TEXT, NO_LANDED_TEXT, showsInbox } from "./model";

/** Every fleet at a glance, and everything that waits on the operator, across fleets, with its action. */
export function FleetsPage() {
  const api = useDashboardApi();
  const live = useLive(() => api.fleets(), [api]);
  return (
    <div className="flex flex-col gap-8 p-4 md:p-6">
      <LiveScreen live={live} what="the Fleets page">
        {(view) => <Sections view={view} refetch={live.refetch} />}
      </LiveScreen>
    </div>
  );
}

function Sections({ view, refetch }: { view: FleetsView; refetch: () => Promise<void> }) {
  return (
    <>
      <section aria-labelledby="fleets-inbox" className="flex flex-col gap-2">
        <h2 id="fleets-inbox" className="text-base font-semibold">
          Waits on you <span className="font-normal text-muted-foreground">{view.waiting}</span>
        </h2>
        {view.needsAccount.length > 0 ? (
          <ul aria-label="Needs an account" className="flex flex-col gap-1 text-sm">
            {view.needsAccount.map((entry) => (
              <li key={`${entry.fleet}:${entry.role}`} className="flex flex-wrap items-baseline gap-x-3">
                <span>{entry.text}</span>
                <button type="button" className={LINK_CLASS} aria-label={`Connect… ${entry.role} of ${entry.fleet}`} onClick={() => openConnect({ target: { fleet: entry.fleet, role: entry.role } })}>
                  Connect…
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {showsInbox(view) ? <InboxTable rows={view.inbox} unreadable={view.unreadableInbox} now={view.generatedAt} inFleetTab={false} refetch={refetch} /> : null}
        {view.recentActions.length > 0 ? (
          <ul aria-label="Recently sent" className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            {view.recentActions.map((action) => (
              <li key={action.id}>
                {action.fleet} {recentActionText(action)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section aria-labelledby="fleets-cards" className="flex flex-col gap-2">
        <h2 id="fleets-cards" className="text-base font-semibold">
          Fleets
        </h2>
        {view.fleets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {NO_FLEET_TEXT} <code className="rounded bg-secondary px-1">{NO_FLEET_COMMAND}</code> {NO_FLEET_TAIL}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.fleets.map((card) => (
              <FleetCard key={card.managerThreadId} card={card} now={view.generatedAt} />
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="fleets-landed" className="flex flex-col gap-2">
        <h2 id="fleets-landed" className="text-base font-semibold">
          Recently landed <span className="text-sm font-normal text-muted-foreground">last 7 days, all fleets</span>
        </h2>
        {view.landed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{NO_LANDED_TEXT}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {view.landed.map((row) => (
              <li key={`${row.fleet}:${row.ref}:${row.merged}`} className="flex items-baseline gap-2 rounded-md border border-border px-2 py-1">
                <span className="text-muted-foreground">{row.fleet}</span>
                <span>{itemTitle(row.ref, row.spec)}</span>
                <ItemLink link={row.link} managerThreadId="" />
                <span className="text-muted-foreground">{landedDate(row)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
