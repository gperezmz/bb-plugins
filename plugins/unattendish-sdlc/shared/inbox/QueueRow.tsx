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
/** The columns of a queue row: kind, title, link, age, fleet, action. */
const COLUMNS = "grid grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_minmax(0,10rem)_auto] items-center gap-x-3";

/** A fleet's logo and name; a short name shown in place of the full one leaves the full one to assistive technology. */
export function FleetName({ fleet, name, short = name, className }: { fleet: FleetCardView | undefined; name: string; short?: string; className?: string }) {
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

interface QueueRowProps {
  readonly row: InboxRowView;
  readonly now: string;
  /** The row's fleet, for its logo where the row names its fleet. */
  readonly fleet: FleetCardView | undefined;
  /** How the row names its fleet where it does: its short name on a phone. */
  readonly shortName?: string;
  readonly showFleet: boolean;
  /**
   * `columns` lines the row up under the queue's columns; `phone` gives the title, the details and the action a line
   * each, for a phone's queue; `two-line` puts the kind's icon, the title and the action on one line and the link and
   * the age on a second, for the Fleet tab's narrow panel.
   */
  readonly layout: "columns" | "phone" | "two-line";
  /** Touch-sized buttons in the `two-line` layout, for a coarse pointer on a phone; the `phone` layout always has them. */
  readonly touch?: boolean;
  readonly state: RowActionState;
}

/** One Inbox row: the kind's icon and title, its link and age, its fleet where shown, and its action or the action's state, with the composer under it. */
export function QueueRow({ row, now, fleet, shortName = row.fleet, showFleet, layout, touch = false, state }: QueueRowProps) {
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
    <span className={cn("flex items-center gap-1 text-xs tabular-nums", layout === "phone" && "whitespace-nowrap", age.long ? "text-warning-text" : "text-muted-foreground")}>
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
  if (layout === "two-line") {
    return (
      <li className="flex flex-col gap-1 py-3">
        <span className="flex min-w-0 items-center gap-2">
          {kind}
          <span className="min-w-0 flex-1">{title}</span>
          <span className="shrink-0">
            <ActionCell row={row} action={action} state={state} buttons={touch ? TOUCH_BUTTON : BUTTON} note={false} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-x-3 pl-6">
          <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={shortLinkLabel(row)} className="min-w-0 truncate text-xs" />
          {/* The row keeps to two lines, so the unconfirmed note is an icon here, its words on hover and to assistive technology. */}
          {action.kind === "offer" && action.unconfirmed ? (
            <Tip text={UNCONFIRMED}>
              <span tabIndex={0} aria-label={UNCONFIRMED} className={cn(FOCUS, "shrink-0 text-muted-foreground")}>
                <Glyph name={ICONS.unconfirmed} />
              </span>
            </Tip>
          ) : null}
          <span className="ml-auto shrink-0">{ageCell}</span>
        </span>
        {composer}
      </li>
    );
  }
  if (layout === "phone") {
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
        <ActionCell row={row} action={action} state={state} buttons={BUTTON} note />
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
        <button type="button" aria-label={`Review the manifest of ${review.fleet} in its Fleet tab`} className={cn(FOCUS, "text-xs font-medium text-destructive-text")} onClick={() => open(review.managerThreadId)}>
          Review
        </button>
      ) : null}
    </li>
  );
}

/** Said beside an action, or under it on a phone, whose last send failed with its result unknown, once the server's view showed it not sent. */
const UNCONFIRMED = "could not confirm whether the last send went through";

/** The kind of wait each action answers, for its icon and tone. */
export const OFFER_KIND: Readonly<Record<"answer" | "grant" | "build", InboxRowView["waitsFor"]>> = { answer: "answer", grant: "grant", build: "ready" };

const QUIET = "flex items-center gap-1 text-xs text-muted-foreground";

/** The offered buttons at the header's height, and at a touch target's. */
const BUTTON = "flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent";
const TOUCH_BUTTON = "flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs hover:bg-accent";

/**
 * The action cell: the offered action as outlined buttons in the kind's colour, `buttons` sizing them, or the action's
 * state; `note` spells out an unconfirmed send beside the buttons.
 */
function ActionCell({ row, action, state, buttons, note }: { row: InboxRowView; action: RowAction; state: RowActionState; buttons: string; note: boolean }) {
  if (state.composing !== null && action.kind === "offer") return <span className={QUIET}>composing…</span>;
  if (action.kind !== "offer") return <ActionState action={action} className={QUIET} />;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <OfferButtons row={row} offer={action.offer} state={state} className={buttons} />
      {note && action.unconfirmed ? <span className="text-xs text-muted-foreground">{UNCONFIRMED}</span> : null}
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
