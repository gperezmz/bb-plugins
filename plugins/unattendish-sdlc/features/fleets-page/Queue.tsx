import { useState } from "react";
import type { ActionRecordView, FleetCardView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { sentAgo, sentText } from "@/shared/fleet-header/model";
import { FleetName, OFFER_KIND, QueueRow, UnreadableRow } from "@/shared/inbox/QueueRow";
import { useRowActions } from "@/shared/inbox/use-row-action";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { ICONS, KIND_ICONS } from "@/shared/look/icons";
import { KIND_TONES } from "@/shared/look/tones";
import { NOTHING_WAITS, NOTHING_WAITS_LINE, TAB_NAMES, tabCounts, tabRows, tabsShown, type QueueView, type Tab } from "./model";

interface QueueProps {
  readonly queue: QueueView;
  readonly now: string;
  /** Each fleet's card by its name, for its logo. */
  readonly fleets: ReadonlyMap<string, FleetCardView>;
  /** The fleet the queue is filtered to; its rows then leave the fleet out. */
  readonly filter: string | null;
  onClearFilter(): void;
  readonly compact: boolean;
  readonly refetch: () => Promise<void>;
}

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Every Inbox row across fleets, or the filtered fleet's, oldest first, with tabs by kind and a Sent tab. */
export function Queue({ queue, now, fleets, filter, onClearFilter, compact, refetch }: QueueProps) {
  const [picked, setPicked] = useState<Tab>("all");
  const stateOf = useRowActions(refetch);
  const counts = tabCounts(queue);
  const tabs = tabsShown(counts);
  // A tab that stops being drawn (Unreadable once its last row reads) falls back to All.
  const tab = tabs.includes(picked) ? picked : "all";
  const { rows, unreadable } = tabRows(queue, tab);
  const showFleet = filter === null;
  const card = filter === null ? undefined : fleets.get(filter);
  return (
    <section aria-label="Queue" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
        <div role="tablist" aria-label="Kind" className="flex flex-wrap items-center gap-1">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={cn(
                FOCUS,
                "flex items-center gap-1 px-2 py-1 text-xs",
                name === "sent" && "ml-2 border-l border-border pl-3",
                compact ? "min-h-9 rounded-full border border-border" : "rounded-md",
                tab === name ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setPicked(name)}
            >
              {TAB_NAMES[name]}{" "}
              <span className="tabular-nums text-muted-foreground">{counts[name]}</span>
            </button>
          ))}
        </div>
        {filter !== null ? (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 text-xs">
            {card !== undefined ? <ServiceLogo service={card.forge} decorative /> : null}
            {filter}
            <button type="button" aria-label={`Show every fleet, not only ${filter}`} className={cn(FOCUS, "flex size-5 items-center justify-center text-muted-foreground hover:text-foreground")} onClick={onClearFilter}>
              <Glyph name={ICONS.clear} className="size-3" />
            </button>
          </span>
        ) : null}
      </div>
      <div role="tabpanel" aria-label={TAB_NAMES[tab]}>
        {tab === "sent" ? (
          <SentList actions={queue.sent} now={now} fleets={fleets} showFleet={showFleet} />
        ) : rows.length === 0 && unreadable.length === 0 ? (
          <NothingWaits />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <QueueRow key={row.id} row={row} now={now} fleet={fleets.get(row.fleet)} showFleet={showFleet} layout={compact ? "two-line" : "columns"} touch={compact} state={stateOf(row)} />
            ))}
            {unreadable.map((row) => (
              <UnreadableRow key={`${row.fleet}:${row.line}`} row={row} section="Inbox" review={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NothingWaits() {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <Glyph name={ICONS.nothingWaits} tone="green" className="size-5" />
      <p className="font-medium">{NOTHING_WAITS}</p>
      <p className="text-xs text-muted-foreground">{NOTHING_WAITS_LINE}</p>
    </div>
  );
}

function SentList({ actions, now, fleets, showFleet }: { actions: readonly ActionRecordView[]; now: string; fleets: ReadonlyMap<string, FleetCardView>; showFleet: boolean }) {
  if (actions.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">Nothing you sent was seen done in the last hour</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {actions.map((action) => {
        const kind = OFFER_KIND[action.kind];
        return (
          <li key={action.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Glyph name={KIND_ICONS[kind]} tone={KIND_TONES[kind]} />
            <span className="min-w-0 flex-1 truncate">{sentText(action)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{sentAgo(action, now)}</span>
            {showFleet ? <FleetName fleet={fleets.get(action.fleet)} name={action.fleet} /> : null}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Glyph name={ICONS.done} tone="green" />
              done
            </span>
          </li>
        );
      })}
    </ul>
  );
}
