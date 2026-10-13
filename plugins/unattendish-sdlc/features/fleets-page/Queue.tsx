import { useState } from "react";
import type { ActionOffer, ActionRecordView, FleetCardView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
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
import { NOTHING_WAITS, NOTHING_WAITS_LINE, rowAge, shortLinkLabel, sentAgo, sentText, TAB_NAMES, tabCounts, tabRows, tabsShown, unreadableLine, type QueueView, type Tab } from "./model";

interface QueueProps {
  readonly queue: QueueView;
  readonly now: string;
  /** Each fleet's card by its name, for its logo. */
  readonly fleets: ReadonlyMap<string, FleetCardView>;
  /** The fleet the queue is filtered to; its rows then leave the fleet out. */
  readonly filter: string | null;
  onClearFilter(): void;
  readonly compact: boolean;
  /** How a fleet is named: its short name on a phone, its full name otherwise. */
  nameOf(fleet: string): string;
  readonly refetch: () => Promise<void>;
}

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
/** The columns of a queue row: kind, title, link, age, fleet, action. */
const COLUMNS = "grid grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_minmax(0,10rem)_auto] items-center gap-x-3";

/** Every Inbox row across fleets, or the filtered fleet's, oldest first, with tabs by kind and a Sent tab. */
export function Queue({ queue, now, fleets, filter, onClearFilter, compact, nameOf, refetch }: QueueProps) {
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
          <span className={cn("ml-auto flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border pl-2 text-xs", compact ? "pr-0" : "py-0.5 pr-1")}>
            {card !== undefined ? <ServiceLogo service={card.forge} decorative /> : null}
            <span className="truncate">{nameOf(filter)}</span>
            <button type="button" aria-label={`Show every fleet, not only ${filter}`} className={cn(FOCUS, "flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground", compact ? "size-11" : "size-5")} onClick={onClearFilter}>
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
              <QueueRow key={row.id} row={row} now={now} fleet={fleets.get(row.fleet)} shortName={nameOf(row.fleet)} showFleet={showFleet} compact={compact} state={stateOf(row)} />
            ))}
            {unreadable.map((row) => (
              <UnreadableRow key={`${row.fleet}:${row.line}`} row={row} />
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

/** A fleet's logo and name; a short name shown in place of the full one leaves the full one to assistive technology. */
function FleetName({ fleet, name, short = name, className }: { fleet: FleetCardView | undefined; name: string; short?: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}>
      {fleet !== undefined ? <ServiceLogo service={fleet.forge} decorative /> : null}
      {short === name ? (
        <span className="truncate">{name}</span>
      ) : (
        <>
          <span aria-hidden className="truncate">
            {short}
          </span>
          <span className="sr-only">{name}</span>
        </>
      )}
    </span>
  );
}

/** A tap area at least 44 px square centred on a small link, reaching past its text without moving what is beside it. */
const TAP_AREA = "relative before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-[max(100%,2.75rem)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

function QueueRow({ row, now, fleet, shortName, showFleet, compact, state }: { row: InboxRowView; now: string; fleet: FleetCardView | undefined; shortName: string; showFleet: boolean; compact: boolean; state: RowActionState }) {
  const action = rowAction(row, now, state);
  const age = rowAge(row, now);
  const kind = <Glyph name={KIND_ICONS[row.waitsFor]} tone={KIND_TONES[row.waitsFor]} />;
  const title = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{itemTitle(row.ref, row.what)}</span>
      {/* A refusal of words shows in their composer; one of Build it or Re-grant, which have none, shows here. */}
      {action.kind === "offer" && action.refusal !== null && state.composing === null ? (
        <Tip text={action.refusal}>
          <span tabIndex={0} aria-label={`not sent: ${action.refusal}`} className={cn(FOCUS, "shrink-0 text-xs font-medium text-destructive-text")}>
            not sent
          </span>
        </Tip>
      ) : null}
    </span>
  );
  const ageCell = (
    <span className={cn("flex items-center gap-1 text-xs tabular-nums", compact && "whitespace-nowrap", age.long ? "text-warning-text" : "text-muted-foreground")}>
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
      <li className="flex flex-col gap-2 py-3">
        {/* The title has the row's width beside the kind and wraps onto a second line before it is cut. */}
        <span className="flex items-start gap-2">
          <span className="flex h-5 shrink-0 items-center">{kind}</span>
          <span className="line-clamp-2 min-w-0 flex-1">{itemTitle(row.ref, row.what)}</span>
        </span>
        {/* The details wrap as two pieces: a short name too wide to share the line takes it whole, cut only where it
            is wider than the row, and the link and the age, which never part, go under it. It takes the row's whole
            width, unindented, so a long short name has all of it. Its margin keeps the link's tap area, which reaches
            14 px past a line of text, clear of the title and the buttons. */}
        <span className="my-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {showFleet ? <FleetName fleet={fleet} name={row.fleet} short={shortName} className="max-w-full shrink-0" /> : null}
          <span className="flex shrink-0 grow items-center gap-3">
            <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={shortLinkLabel(row)} arrowOnly className={cn("text-xs", TAP_AREA)} />
            <span className="ml-auto">{ageCell}</span>
          </span>
        </span>
        <ActionLine row={row} action={action} state={state} />
        {composer}
      </li>
    );
  }
  return (
    <li className="flex flex-col">
      <div className={cn(COLUMNS, "py-2", !showFleet && "grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_auto]")}>
        {kind}
        {title}
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={shortLinkLabel(row)} className="text-xs" />
        {ageCell}
        {showFleet ? <FleetName fleet={fleet} name={row.fleet} /> : null}
        <ActionCell row={row} action={action} state={state} />
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

/** Said beside an action, or under it on a phone, whose last send failed with its result unknown, once the server's view showed it not sent. */
const UNCONFIRMED = "could not confirm whether the last send went through";

const OFFER_KIND: Readonly<Record<"answer" | "grant" | "build", InboxRowView["waitsFor"]>> = { answer: "answer", grant: "grant", build: "ready" };

const QUIET = "flex items-center gap-1 text-xs text-muted-foreground";

/** The action cell: the offered action as an outlined button in the kind's colour, or the action's state. */
function ActionCell({ row, action, state }: { row: InboxRowView; action: RowAction; state: RowActionState }) {
  if (state.composing !== null && action.kind === "offer") return <span className={QUIET}>composing…</span>;
  if (action.kind !== "offer") return <ActionState action={action} className={QUIET} />;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <OfferButtons row={row} offer={action.offer} state={state} className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent" />
      {action.unconfirmed ? <span className="text-xs text-muted-foreground">{UNCONFIRMED}</span> : null}
    </span>
  );
}

/**
 * The action line of a row on a phone: the offered buttons across the row, Grant… and Re-grant at half each, a refusal
 * and an unconfirmed send spelled out under them; every other state as text at the buttons' height, so the row keeps
 * its height, but watch only, which never turns into a button.
 */
function ActionLine({ row, action, state }: { row: InboxRowView; action: RowAction; state: RowActionState }) {
  const held = cn(QUIET, "h-11");
  const composing = state.composing !== null && action.kind === "offer";
  return (
    <div className="flex flex-col gap-1">
      {composing ? (
        <span className={held}>composing…</span>
      ) : action.kind !== "offer" ? (
        <ActionState action={action} className={action.kind === "none" ? QUIET : held} />
      ) : (
        <div className="flex gap-2">
          <OfferButtons row={row} offer={action.offer} state={state} className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-3 text-xs hover:bg-accent" />
        </div>
      )}
      {/* A refusal of words shows in their composer; one of Build it or Re-grant, which have none, shows here. */}
      {action.kind === "offer" && action.refusal !== null && !composing ? <p className="text-xs text-destructive-text">Not sent: {action.refusal}</p> : null}
      {action.kind === "offer" && action.unconfirmed ? <p className="text-xs text-muted-foreground">{UNCONFIRMED}</p> : null}
    </div>
  );
}

/** Every state of a row's action but an offer, in words. */
function ActionState({ action, className }: { action: Exclude<RowAction, { kind: "offer" }>; className: string }) {
  switch (action.kind) {
    case "none":
      return <span className={className}>watch only</span>;
    case "sending":
      return (
        <span className={className}>
          <Glyph name={ICONS.sending} spin />
          {action.text}
        </span>
      );
    case "unknown":
    case "sent":
      return <span className={className}>{action.text}</span>;
    case "done":
      return (
        <span className={className}>
          <Glyph name={ICONS.done} tone="green" />
          done
        </span>
      );
  }
}

/** The offered action as an outlined button in the kind's colour, and Re-grant beside it for a grant carried over. */
function OfferButtons({ row, offer, state, className }: { row: InboxRowView; offer: ActionOffer; state: RowActionState; className: string }) {
  const kind = OFFER_KIND[offer.kind];
  const tone = KIND_TONES[kind];
  return (
    <>
      <button
        type="button"
        aria-label={actionName(offer.label, row)}
        className={cn(FOCUS, className, "font-medium", TONE_BORDER[tone], TONE_TEXT[tone])}
        onClick={() => (offer.kind === "build" ? void state.send("build") : state.compose(offer.kind))}
      >
        <Glyph name={KIND_ICONS[kind]} />
        {offer.label}
      </button>
      {offer.regrant ? (
        <button type="button" aria-label={actionName("Re-grant", row)} className={cn(FOCUS, className, "border-border")} onClick={() => void state.send("grant", { regrant: true })}>
          Re-grant
        </button>
      ) : null}
    </>
  );
}

function SentList({ actions, now, fleets, showFleet, nameOf }: { actions: readonly ActionRecordView[]; now: string; fleets: ReadonlyMap<string, FleetCardView>; showFleet: boolean; nameOf(fleet: string): string }) {
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
