import { useEffect, useState } from "react";
import type { ActionRecordView, FleetCardView, InboxRowView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { sentAgo, sentText } from "@/shared/fleet-header/model";
import { FleetName, OFFER_KIND, QueueRow, TAP_AREA, UnreadableRow } from "@/shared/inbox/QueueRow";
import { rowAction, rowKey, sameRow } from "@/shared/inbox/row-model";
import type { RowActionState } from "@/shared/inbox/use-row-action";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS, KIND_ICONS } from "@/shared/look/icons";
import { KIND_TONES } from "@/shared/look/tones";
import { composerFor, NOTHING_WAITS, NOTHING_WAITS_LINE, TAB_NAMES, tabCounts, tabRows, tabShowing, tabsShown, type QueueView, type Tab } from "./model";

/** A row to show with its composer open, as a toast's request names it; `seq` tells two requests for the same row apart. */
export interface OpenRow {
  readonly fleet: string;
  readonly rowId: string;
  readonly seq: number;
}

/** The id of the row a toast opened, for scrolling it into view and focusing its composer. */
const OPENED_ID = "fleets-queue-opened-row";

interface QueueProps {
  readonly queue: QueueView;
  readonly now: string;
  /** Each fleet's card by its name, for its logo. */
  readonly fleets: ReadonlyMap<string, FleetCardView>;
  /** The fleet the queue is filtered to; its rows then leave the fleet out. */
  readonly filter: string | null;
  onClearFilter(): void;
  /** Whether the page shows its narrow layout. */
  readonly narrow: boolean;
  /** How a fleet is named: its short name in the narrow layout, its full name otherwise. */
  nameOf(fleet: string): string;
  /** The tab shown, kept above the page's loading state, as the rows' actions are, so a reload keeps it. */
  readonly tab: Tab;
  onTab(tab: Tab): void;
  /** Each row's action state, from `useRowActions`. */
  stateOf(row: InboxRowView): RowActionState;
  /** The row a toast asked for: the queue shows it, opens its composer where it offers one, and focuses it. */
  readonly opening?: OpenRow | null;
}

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Every Inbox row across fleets, or the filtered fleet's, oldest first, with tabs by kind and a Sent tab. */
export function Queue({ queue, now, fleets, filter, onClearFilter, narrow, nameOf, tab: picked, onTab: setPicked, stateOf, opening = null }: QueueProps) {
  const [opened, setOpened] = useState<OpenRow | null>(null);
  // Shows the row a toast asked for, on a tab that lists it, with the composer its own button opens; a composer already
  // open keeps its draft, and a row whose action is under way, sent or done opens none.
  useEffect(() => {
    if (opening === null) return;
    const row = queue.rows.find((shown) => sameRow(shown, { fleet: opening.fleet, id: opening.rowId }));
    if (row === undefined) return;
    setPicked(tabShowing(queue, picked, row));
    const state = stateOf(row);
    const verb = composerFor(rowAction(row, now, state));
    if (verb !== null && state.composing !== verb) state.compose(verb);
    setOpened(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a request is acted on once, when it arrives.
  }, [opening]);
  // Once drawn, the row is scrolled into view and its composer, where open, focused.
  useEffect(() => {
    if (opened === null) return;
    const row = document.getElementById(OPENED_ID);
    row?.scrollIntoView?.({ block: "nearest" });
    row?.querySelector("textarea")?.focus();
  }, [opened]);
  const counts = tabCounts(queue);
  const tabs = tabsShown(counts);
  // A tab that stops being drawn (Unreadable once its last row reads) falls back to All.
  const tab = tabs.includes(picked) ? picked : "all";
  const { rows, unreadable } = tabRows(queue, tab);
  const showFleet = filter === null;
  const card = filter === null ? undefined : fleets.get(filter);
  return (
    <section aria-label="Queue" className="flex flex-col gap-2 text-sm">
      {/* The gaps between wrapped lines keep the tabs' and the ✕'s tap areas, which reach past what is drawn, apart. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-3.5 border-b border-border pb-1">
        <div role="tablist" aria-label="Kind" className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={cn(
                FOCUS,
                "relative flex h-6 items-center gap-1 rounded-md px-2 text-xs",
                // A tap area 32 px tall, 4 px past the tab above and below.
                "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
                name === "sent" && "ml-2 border-l border-border pl-3",
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
          <span className="ml-auto flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md bg-accent pl-2 pr-0.5 text-xs">
            <FleetName fleet={card} name={filter} short={nameOf(filter)} className="text-foreground" />
            {/* In the narrow layout the ✕ has a 44 px tap area, with room before it so the area stays off the name. */}
            <button type="button" aria-label={`Show every fleet, not only ${filter}`} className={cn(FOCUS, "flex size-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground", narrow && "ml-2", narrow && TAP_AREA)} onClick={onClearFilter}>
              <Glyph name={ICONS.clear} className="size-3" />
            </button>
          </span>
        ) : null}
      </div>
      <div role="tabpanel" aria-label={TAB_NAMES[tab]}>
        {tab === "sent" ? (
          <SentList actions={queue.sent} now={now} fleets={fleets} showFleet={showFleet} nameOf={nameOf} />
        ) : rows.length === 0 && unreadable.length === 0 ? (
          <NothingWaits />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <QueueRow key={rowKey(row)} id={opened !== null && sameRow(row, { fleet: opened.fleet, id: opened.rowId }) ? OPENED_ID : undefined} row={row} now={now} fleet={fleets.get(row.fleet)} shortName={nameOf(row.fleet)} showFleet={showFleet} layout={narrow ? "stacked" : "columns"} state={stateOf(row)} />
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

function SentList({ actions, now, fleets, showFleet, nameOf }: { actions: readonly ActionRecordView[]; now: string; fleets: ReadonlyMap<string, FleetCardView>; showFleet: boolean; nameOf(fleet: string): string }) {
  if (actions.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">Nothing you sent was seen done in the last hour</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {actions.map((action) => {
        const kind = OFFER_KIND[action.kind];
        return (
          <li key={rowKey(action)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Glyph name={KIND_ICONS[kind]} tone={KIND_TONES[kind]} />
            <span className="min-w-0 flex-1 truncate">{sentText(action)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{sentAgo(action, now)}</span>
            {showFleet ? <FleetName fleet={fleets.get(action.fleet)} name={action.fleet} short={nameOf(action.fleet)} /> : null}
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
