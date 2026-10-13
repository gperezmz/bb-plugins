import type { ActionOffer, FleetCardView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { Glyph, ServiceLogo } from "../look/Glyph";
import { ICONS, KIND_ICONS } from "../look/icons";
import { Tip } from "../look/Tip";
import { KIND_TONES, TONE_BORDER, TONE_TEXT } from "../look/tones";
import { ItemLink } from "../ItemLink";
import { itemTitle } from "../item-title";
import { useOpenFleetTab } from "../open-fleet-tab";
import { ActionComposer } from "./ActionComposer";
import { actionName, rowAction, rowAge, shortLinkLabel, unreadableLine, type RowAction } from "./row-model";
import type { RowActionState } from "./use-row-action";

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
/**
 * The columns of a queue row: kind, title, link, age, fleet, action. None shrinks below what it holds whole: the title
 * keeps 12rem, the link is cut at 16rem, the age fits 99d 23h, so the row has a width the Fleets page's switch point is
 * sized to.
 */
const COLUMNS = "grid grid-cols-[1rem_minmax(min-content,1fr)_auto_4.5rem_10rem_auto] items-center gap-x-3";
const COLUMNS_NO_FLEET = "grid-cols-[1rem_minmax(min-content,1fr)_auto_4.5rem_auto]";

/**
 * A fleet's logo and name; a short name shown in place of the full one leaves the full one to assistive technology,
 * and shows it on hover and on keyboard focus.
 */
export function FleetName({ fleet, name, short = name, className }: { fleet: FleetCardView | undefined; name: string; short?: string; className?: string }) {
  const logo = fleet !== undefined ? <ServiceLogo service={fleet.forge} decorative /> : null;
  const box = cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className);
  if (short === name) {
    return (
      <span className={box}>
        {logo}
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return (
    <Tip text={name}>
      <span tabIndex={0} className={cn(FOCUS, box)}>
        {logo}
        <span aria-hidden className="truncate">
          {short}
        </span>
        <span className="sr-only">{name}</span>
      </span>
    </Tip>
  );
}

/** A tap area at least 44 px square centred on a small link, reaching past its text without moving what is beside it. */
const TAP_AREA = "relative before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-[max(100%,2.75rem)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

interface QueueRowProps {
  readonly row: InboxRowView;
  readonly now: string;
  /** The row's fleet, for its logo where the row names its fleet. */
  readonly fleet: FleetCardView | undefined;
  /** How the row names its fleet where it does: its short name in the `stacked` layout. */
  readonly shortName?: string;
  readonly showFleet: boolean;
  /**
   * `columns` lines the row up under the queue's columns, for the Fleets page's wide layout; `stacked` gives the
   * title, the details and the action a line each, for its narrow layout; `two-line` puts the kind's icon, the title and the action on one line and the link and
   * the age on a second, for the Fleet tab's side panel.
   */
  readonly layout: "columns" | "stacked" | "two-line";
  /** Touch-sized buttons in the `two-line` layout, for a coarse pointer on a phone; the `stacked` layout always has them. */
  readonly touch?: boolean;
  readonly state: RowActionState;
  /** The `<li>`'s DOM id, as `UnreadableRow` takes one: for scrolling to the row and finding its composer. */
  readonly id?: string;
}

/**
 * One Inbox row: the kind's icon and title, its link and age, its fleet where shown, and its action or the action's
 * state, with the composer under it. The composer is the row's last child, keyed, in every layout, so a change of
 * layout keeps its text box, and with it the focus and the caret.
 */
export function QueueRow({ row, now, fleet, shortName = row.fleet, showFleet, layout, touch = false, state, id }: QueueRowProps) {
  const action = rowAction(row, now, state);
  const age = rowAge(row, now);
  const linkLabel = shortLinkLabel(row);
  const kind = <Glyph name={KIND_ICONS[row.waitsFor]} tone={KIND_TONES[row.waitsFor]} />;
  const title = (
    // In the columns the title keeps 12rem however long it is, so a long title never widens the row's narrowest width.
    <span className={cn("min-w-0 items-baseline gap-2", layout === "columns" ? "grid grid-cols-[minmax(12rem,max-content)_auto]" : "flex")}>
      <span className="min-w-0 truncate">{itemTitle(row.ref, row.what)}</span>
      {/* A refusal of words shows in their composer; one of Build it or Re-grant, which have none, shows here. */}
      {action.kind === "offer" && action.refusal !== null && state.composing === null ? (
        <Tip text={action.refusal}>
          <span tabIndex={0} aria-label={`not sent: ${action.refusal}`} className={cn(FOCUS, "shrink-0 whitespace-nowrap text-xs font-medium text-destructive-text")}>
            not sent
          </span>
        </Tip>
      ) : null}
    </span>
  );
  const ageCell = (
    <span className={cn("flex items-center gap-1 text-xs tabular-nums", layout !== "two-line" && "whitespace-nowrap", age.long ? "text-warning-text" : "text-muted-foreground")}>
      <Glyph name={ICONS.age} />
      {age.text}
    </span>
  );
  const composer =
    state.composing !== null && (state.composing === "answer" || state.composing === "grant") ? (
      <div key="composer" className="pb-3">
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
  if (layout === "two-line") {
    return (
      <li id={id} className="flex flex-col gap-1 py-3">
        <span className="flex min-w-0 items-center gap-2">
          {kind}
          <span className="min-w-0 flex-1">{title}</span>
          <span className="shrink-0">
            <ActionCell row={row} action={action} state={state} buttons={touch ? TOUCH_BUTTON : BUTTON} unconfirmed={false} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-x-3 pl-6">
          <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={linkLabel} className="min-w-0 truncate text-xs" />
          {/* The row keeps to two lines, so the unconfirmed note is an icon here, its words on hover and to assistive technology. */}
          {action.kind === "offer" && action.unconfirmed ? <UnconfirmedIcon /> : null}
          <span className="ml-auto shrink-0">{ageCell}</span>
        </span>
        {composer}
      </li>
    );
  }
  if (layout === "stacked") {
    return (
      <li id={id} className="flex flex-col gap-2 py-3">
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
            <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={linkLabel} arrowOnly tip className={cn("text-xs", TAP_AREA)} />
            <span className="ml-auto">{ageCell}</span>
          </span>
        </span>
        <ActionLine row={row} action={action} state={state} />
        {composer}
      </li>
    );
  }
  return (
    <li id={id} className="flex flex-col">
      <div className={cn(COLUMNS, "py-2", !showFleet && COLUMNS_NO_FLEET)}>
        {kind}
        {title}
        {/* A short form is shown whole; a link without one is cut at 16rem. */}
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={linkLabel} tip className={cn("whitespace-nowrap text-xs", linkLabel === undefined && "block w-max max-w-[16rem] truncate")} />
        {ageCell}
        {showFleet ? <FleetName fleet={fleet} name={row.fleet} /> : null}
        <ActionCell row={row} action={action} state={state} buttons={BUTTON} unconfirmed />
      </div>
      {composer}
    </li>
  );
}

/**
 * A row the plugin cannot read, as a red line naming its line and why. `section` names its section, for a list holding
 * more than one; `review` names the fleet whose Fleet tab Review opens, for a list outside that tab.
 */
export function UnreadableRow({ row, section, review = null, id }: { row: Pick<UnreadableInboxRowView, "line" | "reason">; section?: string; review?: Pick<UnreadableInboxRowView, "fleet" | "managerThreadId"> | null; id?: string }) {
  const open = useOpenFleetTab();
  return (
    <li id={id} className="flex flex-wrap items-center gap-2 py-2">
      <Glyph name={ICONS.unreadable} tone="red" />
      <span className="min-w-0 flex-1 text-destructive-text">{unreadableLine(row, section)}</span>
      {review !== null ? (
        <button type="button" aria-label={`Review the manifest of ${review.fleet} in its Fleet tab`} className={cn(FOCUS, "text-xs font-medium text-destructive-text")} onClick={() => open({ managerThreadId: review.managerThreadId, fleet: review.fleet, review: true })}>
          Review
        </button>
      ) : null}
    </li>
  );
}

/**
 * Said of an action whose last send failed with its result unknown, once the server's view showed it not sent: spelled
 * out under it in the `stacked` layout, an icon beside it otherwise.
 */
const UNCONFIRMED = "could not confirm whether the last send went through";

/** An unconfirmed send as an icon, its words on hover, on keyboard focus and to assistive technology. */
function UnconfirmedIcon() {
  return (
    <Tip text={UNCONFIRMED}>
      <span tabIndex={0} aria-label={UNCONFIRMED} className={cn(FOCUS, "shrink-0 text-muted-foreground")}>
        <Glyph name={ICONS.unconfirmed} />
      </span>
    </Tip>
  );
}

/** The kind of wait each action answers, for its icon and tone. */
export const OFFER_KIND: Readonly<Record<"answer" | "grant" | "build", InboxRowView["waitsFor"]>> = { answer: "answer", grant: "grant", build: "ready" };

const QUIET = "flex items-center gap-1 text-xs text-muted-foreground";

/** The offered buttons at the header's height, and at a touch target's. */
const BUTTON = "flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent";
const TOUCH_BUTTON = "flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs hover:bg-accent";

/**
 * The action cell: the offered action as outlined buttons in the kind's colour, `buttons` sizing them, or the action's
 * state; `unconfirmed` shows an unconfirmed send as an icon beside the buttons, kept on their line.
 */
function ActionCell({ row, action, state, buttons, unconfirmed }: { row: InboxRowView; action: RowAction; state: RowActionState; buttons: string; unconfirmed: boolean }) {
  if (state.composing !== null && action.kind === "offer") return <span className={QUIET}>composing…</span>;
  if (action.kind !== "offer") return <ActionState action={action} className={QUIET} />;
  return (
    <span className={cn("flex items-center justify-end gap-2", unconfirmed ? "flex-nowrap" : "flex-wrap")}>
      <OfferButtons row={row} offer={action.offer} state={state} className={buttons} />
      {unconfirmed && action.unconfirmed ? <UnconfirmedIcon /> : null}
    </span>
  );
}

/**
 * The action line of a row in the `stacked` layout: the offered buttons across the row, Grant… and Re-grant at half each, a refusal
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
