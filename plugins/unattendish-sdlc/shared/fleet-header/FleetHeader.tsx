import type { ReactNode } from "react";
import type { ActionRecordView, FleetCardView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { trackerOf } from "../card-model";
import { openConnect } from "../connect/requests";
import { fixIcon, flagsOf, type Flag } from "../fleet-flags";
import { Glyph, ServiceLogo } from "../look/Glyph";
import { ICONS } from "../look/icons";
import { Tip } from "../look/Tip";
import { sharedText } from "../thread-fleets";
import { COUNT_TONES, FLAG_TONES, MANAGER_TONES, TONE_TEXT, TONE_TINT } from "../look/tones";
import { lastActionText, managerCell, spendText, statusSlots } from "./model";

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface FleetHeaderProps {
  readonly card: FleetCardView;
  /** The action seen done most recently in the last hour; null leaves its line out. */
  readonly lastAction: ActionRecordView | null;
  readonly now: string;
  /** What Review does: open the Fleet tab's Work tab at what needs reviewing. */
  onReview(): void;
  /** What stands for the fleet's name, such as the Fleet tab's switcher; absent, the name as plain text. */
  readonly name?: ReactNode;
  readonly className?: string;
}

/**
 * The fleet header: the forge's logo, the fleet's name and its tracker; the manager; the four Status counts and the
 * spend; each problem and warning as a strip in its tone with its verb; and the last action seen done in the last hour.
 */
export function FleetHeader({ card, lastAction, now, onReview, name, className }: FleetHeaderProps) {
  const tracker = trackerOf(card.tracker);
  const spend = spendText(card);
  const shared = sharedText(card);
  const flags = flagsOf(card, now);
  return (
    <header aria-label={`Fleet ${card.repo}`} className={cn("flex flex-col gap-2 text-sm", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <ServiceLogo service={card.forge} />
        {name ?? <span className="min-w-0 truncate font-medium">{card.repo}</span>}
        {tracker !== null ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ServiceLogo service={tracker.service} />
            {tracker.key}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Manager card={card} now={now} />
        {statusSlots(card).flatMap((slot) =>
          slot.count === null
            ? []
            : [
                <Tip key={slot.key} text={slot.label}>
                  <span tabIndex={0} aria-label={slot.label} className={cn(FOCUS, "inline-flex items-center gap-1 tabular-nums", TONE_TEXT[COUNT_TONES[slot.key]], slot.key === "waiting" && "font-semibold")}>
                    <Glyph name={ICONS[slot.key]} />
                    {slot.count}
                  </span>
                </Tip>,
              ],
        )}
        {spend !== null && card.cost !== null ? (
          <Tip text={`Spent ${card.cost.period}${shared === null ? "" : `, ${shared}`}`}>
            <span tabIndex={0} aria-label={`${spend} spent ${card.cost.period}${shared === null ? "" : `, ${shared}`}`} className={cn(FOCUS, "min-w-0 text-muted-foreground")}>
              <span className="tabular-nums">{spend}</span>
              {shared !== null ? <span> {shared}</span> : null}
            </span>
          </Tip>
        ) : null}
      </div>
      {flags.length > 0 ? (
        <ul aria-label={`Problems and warnings of ${card.repo}`} className="flex flex-col gap-1">
          {flags.map((flag) => (
            <FlagStrip key={`${flag.kind}:${flag.sentence}`} flag={flag} card={card} onReview={onReview} />
          ))}
        </ul>
      ) : null}
      {lastAction !== null ? (
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Glyph name={ICONS.done} tone="green" />
          <span className="min-w-0 truncate">{lastActionText(lastAction, now)}</span>
        </p>
      ) : null}
    </header>
  );
}

function Manager({ card, now }: { card: FleetCardView; now: string }) {
  const cell = managerCell(card.manager, now);
  const icon = cell.state === "working" ? ICONS.managerWorking : cell.state === "idle" ? ICONS.managerIdle : ICONS.managerNone;
  return (
    <Tip text={cell.words}>
      <span tabIndex={0} className={cn(FOCUS, "inline-flex items-center gap-1 tabular-nums", TONE_TEXT[MANAGER_TONES[cell.state]])}>
        <Glyph name={icon} label={cell.words} spin={cell.state === "working"} />
        {cell.duration !== null ? <span className="text-muted-foreground">{cell.duration}</span> : null}
      </span>
    </Tip>
  );
}

/** A problem or warning as one strip tinted in its tone: its icon, the server's sentence, and its verb where it has one. */
function FlagStrip({ flag, card, onReview }: { flag: Flag; card: FleetCardView; onReview(): void }) {
  const tone = FLAG_TONES[flag.kind];
  const fix = flag.fix;
  const run =
    fix.kind === "fleet-tab"
      ? onReview
      : fix.kind === "connect"
        ? () => openConnect({ target: { fleet: card.repo, role: fix.role } })
        : fix.kind === "renew"
          ? () => openConnect({ target: { fleet: card.repo, role: fix.role }, account: fix.accountId, replaces: fix.credentialId })
          : null;
  return (
    <li className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 text-xs", TONE_TINT[tone], TONE_TEXT[tone])}>
      <Glyph name={fixIcon(flag) ?? ICONS.late} className="mt-px" />
      <span className="min-w-0 flex-1">{flag.sentence}</span>
      {flag.verb !== null && run !== null ? (
        <button type="button" aria-label={`${flag.verb} ${flag.sentence}`} className={cn(FOCUS, "shrink-0 font-semibold underline underline-offset-2")} onClick={run}>
          {flag.verb}
        </button>
      ) : null}
    </li>
  );
}
