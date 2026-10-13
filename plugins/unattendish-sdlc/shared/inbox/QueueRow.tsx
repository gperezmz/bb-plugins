import type { FleetCardView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
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

export function FleetName({ fleet, name, grow = false }: { fleet: FleetCardView | undefined; name: string; grow?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", grow && "min-w-24 flex-1")}>
      {fleet !== undefined ? <ServiceLogo service={fleet.forge} decorative /> : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

interface QueueRowProps {
  readonly row: InboxRowView;
  readonly now: string;
  /** The row's fleet, for its logo where the row names its fleet. */
  readonly fleet: FleetCardView | undefined;
  readonly showFleet: boolean;
  /** `columns` lines the row up under the queue's columns; `two-line` gives it a first line and a second, for a narrow place. */
  readonly layout: "columns" | "two-line";
  /** Touch-sized controls, for a coarse pointer on a phone. */
  readonly touch: boolean;
  readonly state: RowActionState;
}

/** One Inbox row: the kind's icon and title, its link and age, its fleet where shown, and its action or the action's state, with the composer under it. */
export function QueueRow({ row, now, fleet, showFleet, layout, touch, state }: QueueRowProps) {
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
  if (layout === "two-line") {
    return (
      <li className="flex flex-col gap-1 py-3">
        {/* Two lines that never wrap: the title gives its room to the action, and on the second line the fleet and
            the link truncate, the fleet keeping room for its name, so every control stays on screen. */}
        <span className="flex min-w-0 items-center gap-2">
          {kind}
          <span className="min-w-0 flex-1">{title}</span>
          <span className="shrink-0">
            <ActionCell row={row} action={action} state={state} touch={touch} twoLine />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-x-3 pl-6">
          {showFleet ? <FleetName fleet={fleet} name={row.fleet} grow /> : null}
          <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={shortLinkLabel(row)} className="min-w-0 truncate text-xs" />
          {/* A phone keeps the row to two lines, so the unconfirmed note is an icon here, its words on hover and to assistive technology. */}
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
  return (
    <li className="flex flex-col">
      <div className={cn(COLUMNS, "py-2", !showFleet && "grid-cols-[1rem_minmax(0,1fr)_auto_4.5rem_auto]")}>
        {kind}
        {title}
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} label={shortLinkLabel(row)} className="text-xs" />
        {ageCell}
        {showFleet ? <FleetName fleet={fleet} name={row.fleet} /> : null}
        <ActionCell row={row} action={action} state={state} touch={touch} twoLine={false} />
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

/** Said beside an action whose last send failed with its result unknown, once the server's view showed it not sent. */
const UNCONFIRMED = "could not confirm whether the last send went through";

/** The kind of wait each action answers, for its icon and tone. */
export const OFFER_KIND: Readonly<Record<"answer" | "grant" | "build", InboxRowView["waitsFor"]>> = { answer: "answer", grant: "grant", build: "ready" };

/** The action cell: the offered action as an outlined button in the kind's colour, or the action's state. */
function ActionCell({ row, action, state, touch, twoLine }: { row: InboxRowView; action: RowAction; state: RowActionState; touch: boolean; twoLine: boolean }) {
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
      const size = touch ? "min-h-11 px-3" : "h-7 px-2";
      return (
        <span className={cn("flex items-center justify-end gap-2", !twoLine && "flex-wrap")}>
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
          {action.unconfirmed && !twoLine ? <span className="text-xs text-muted-foreground">{UNCONFIRMED}</span> : null}
        </span>
      );
    }
  }
}
