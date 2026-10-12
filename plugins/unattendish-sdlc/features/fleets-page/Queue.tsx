import { useState } from "react";
import type { ActionRecordView, FleetCardView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { ActionComposer } from "@/shared/inbox/ActionComposer";
import { actionName, rowAction, type RowAction } from "@/shared/inbox/row-model";
import { useRowActions, type RowActionState } from "@/shared/inbox/use-row-action";
import { itemTitle } from "@/shared/item-title";
import { ItemLink } from "@/shared/ItemLink";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { ICONS, KIND_ICONS } from "@/shared/look/icons";
import { Tip } from "@/shared/look/Tip";
import { KIND_TONES, TONE_BORDER, TONE_TEXT } from "@/shared/look/tones";
import { useOpenFleetTab } from "@/shared/open-fleet-tab";
import { NOTHING_WAITS, NOTHING_WAITS_LINE, rowAge, sentAgo, sentText, TAB_NAMES, tabCounts, tabRows, tabsShown, unreadableLine, type QueueView, type Tab } from "./model";

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
/** The columns of a queue row: kind, title, link, age, fleet, action. */
const COLUMNS = "grid grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_minmax(0,10rem)_auto] items-center gap-x-3";

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
              <QueueRow key={row.id} row={row} now={now} fleet={fleets.get(row.fleet)} showFleet={showFleet} compact={compact} state={stateOf(row)} />
            ))}
            {unreadable.map((row) => (
              <UnreadableRow key={`${row.managerThreadId}:${row.line}`} row={row} />
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

function FleetName({ fleet, name }: { fleet: FleetCardView | undefined; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {fleet !== undefined ? <ServiceLogo service={fleet.forge} decorative /> : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

function QueueRow({ row, now, fleet, showFleet, compact, state }: { row: InboxRowView; now: string; fleet: FleetCardView | undefined; showFleet: boolean; compact: boolean; state: RowActionState }) {
  const action = rowAction(row, now, state);
  const age = rowAge(row, now);
  const kind = <Glyph name={KIND_ICONS[row.waitsFor]} tone={KIND_TONES[row.waitsFor]} />;
  const title = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{itemTitle(row.ref, row.what)}</span>
      {action.kind === "offer" && action.offer.kind === "build" && action.refusal !== null ? (
        <Tip text={action.refusal}>
          <span tabIndex={0} aria-label={`not sent: ${action.refusal}`} className={cn(FOCUS, "shrink-0 text-xs font-medium text-destructive-text")}>
            not sent
          </span>
        </Tip>
      ) : null}
    </span>
  );
  const ageCell = (
    <span className={cn("flex items-center gap-1 text-xs tabular-nums", age.long ? "text-warning-text" : "text-muted-foreground")}>
      <Glyph name={ICONS.age} />
      {age.text}
    </span>
  );
  const composer =
    state.composing !== null && (state.composing === "answer" || state.composing === "grant") ? (
      <div className="pb-3">
        <ActionComposer
          row={row}
          verb={state.composing}
          text={state.text}
          onText={state.setText}
          onSend={() => void state.send(state.composing!)}
          onCancel={state.cancel}
          refusal={state.refusal}
        />
      </div>
    ) : null;
  if (compact) {
    return (
      <li className="flex flex-col gap-1 py-3">
        <span className="flex items-center gap-2">
          {kind}
          {title}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
          {showFleet ? <FleetName fleet={fleet} name={row.fleet} /> : null}
          <ItemLink link={row.link} managerThreadId={row.managerThreadId} className="text-xs" />
          {ageCell}
          <span className="ml-auto">
            <ActionCell row={row} action={action} state={state} compact />
          </span>
        </span>
        {composer}
      </li>
    );
  }
  return (
    <li className="flex flex-col">
      <div className={cn(COLUMNS, "py-2", !showFleet && "grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_auto]")}>
        {kind}
        {title}
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} className="text-xs" />
        {ageCell}
        {showFleet ? <FleetName fleet={fleet} name={row.fleet} /> : null}
        <ActionCell row={row} action={action} state={state} compact={false} />
      </div>
      {composer}
    </li>
  );
}

function UnreadableRow({ row }: { row: UnreadableInboxRowView }) {
  const open = useOpenFleetTab();
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Glyph name={ICONS.unreadable} tone="red" />
      <span className="min-w-0 flex-1 text-destructive-text">{unreadableLine(row)}</span>
      <button type="button" aria-label={`Review the manifest of ${row.fleet} in its Fleet tab`} className={cn(FOCUS, "text-xs font-medium text-destructive-text")} onClick={() => open(row.managerThreadId)}>
        Review
      </button>
    </li>
  );
}

const OFFER_KIND: Readonly<Record<"answer" | "grant" | "build", InboxRowView["waitsFor"]>> = { answer: "answer", grant: "grant", build: "ready" };

/** The action cell: the offered action as an outlined button in the kind's colour, or the action's state. */
function ActionCell({ row, action, state, compact }: { row: InboxRowView; action: RowAction; state: RowActionState; compact: boolean }) {
  const quiet = "flex items-center gap-1 text-xs text-muted-foreground";
  if (state.composing !== null && action.kind === "offer") return <span className={quiet}>composing…</span>;
  switch (action.kind) {
    case "none":
      return <span className={quiet}>watch only</span>;
    case "sending":
      return (
        <span className={quiet}>
          <Glyph name={ICONS.sending} spin />
          {action.text}
        </span>
      );
    case "unknown":
    case "sent":
      return <span className={quiet}>{action.text}</span>;
    case "done":
      return (
        <span className={quiet}>
          <Glyph name={ICONS.done} tone="green" />
          done
        </span>
      );
    case "offer": {
      const { offer } = action;
      const kind = OFFER_KIND[offer.kind];
      const tone = KIND_TONES[kind];
      const size = compact ? "min-h-11 px-3" : "h-7 px-2";
      return (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            aria-label={actionName(offer.label, row)}
            className={cn(FOCUS, "flex items-center gap-1 rounded-md border text-xs font-medium hover:bg-accent", size, TONE_BORDER[tone], TONE_TEXT[tone])}
            onClick={() => (offer.kind === "build" ? void state.send("build") : state.compose(offer.kind))}
          >
            <Glyph name={KIND_ICONS[kind]} />
            {offer.label}
          </button>
          {offer.regrant ? (
            <button type="button" aria-label={actionName("Re-grant", row)} className={cn(FOCUS, "rounded-md border border-border text-xs hover:bg-accent", size)} onClick={() => void state.send("grant", { regrant: true })}>
              Re-grant
            </button>
          ) : null}
          {action.unconfirmed ? <span className="text-xs text-muted-foreground">could not confirm whether the last send went through</span> : null}
        </span>
      );
    }
  }
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
