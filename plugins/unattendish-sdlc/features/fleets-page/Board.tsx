import { useState, type MouseEvent } from "react";
import type { FleetCardView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { trackerOf } from "@/shared/card-model";
import { openConnect } from "@/shared/connect/requests";
import { fixIcon, flagsOf, flagSummary, phoneFlagIcon, worstFlag, type Flag } from "@/shared/fleet-flags";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { Tip } from "@/shared/look/Tip";
import { COUNT_TONES, FLAG_TONES, MANAGER_TONES, TONE_FILL, TONE_TEXT } from "@/shared/look/tones";
import { useOpenFleetTab } from "@/shared/open-fleet-tab";
import { sharedText } from "@/shared/thread-fleets";
import { managerCell, spendText, statusSlots } from "@/shared/fleet-header/model";
import { boardLines, moreLabel, phoneBoard, pollingCell, quietLabel, STATUS_HEADER_TEXT } from "./model";

interface BoardProps {
  readonly cards: readonly FleetCardView[];
  readonly now: string;
  /** The fleet the queue is filtered to. */
  readonly selected: string | null;
  onSelect(fleet: string | null): void;
}

/** The columns every line shares, so each cell sits under its header: fleet, manager, Status, spend, polling, fix, Fleet tab. */
const COLUMNS = "grid grid-cols-[minmax(10rem,1fr)_4.5rem_auto_4.5rem_5rem_minmax(5rem,auto)_2rem] items-center gap-x-3";
const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** What a flag's fix does: opens the Fleet tab or the Connect popup; nothing for a flag the page cannot fix. */
function useFix(card: FleetCardView): (flag: Flag) => (() => void) | null {
  const openFleetTab = useOpenFleetTab();
  return (flag) => {
    const fix = flag.fix;
    if (fix.kind === "fleet-tab") return () => openFleetTab({ managerThreadId: card.managerThreadId, fleet: card.repo, review: true });
    if (fix.kind === "connect") return () => openConnect({ target: { fleet: card.repo, role: fix.role } });
    if (fix.kind === "renew") return () => openConnect({ target: { fleet: card.repo, role: fix.role }, account: fix.accountId, replaces: fix.credentialId });
    return null;
  };
}

/** Toggles the filter when a line is clicked anywhere but on one of its buttons, which act on their own. */
function lineClick(onToggle: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a") !== null) return;
    onToggle();
  };
}

/** One line per fleet that isn't quiet, the quiet ones folded under one line; problems first. */
export function Board({ cards, now, selected, onSelect }: BoardProps) {
  const [showQuiet, setShowQuiet] = useState(false);
  const { listed, quiet } = boardLines(cards, now, selected);
  const toggle = (repo: string) => onSelect(selected === repo ? null : repo);
  return (
    <section aria-label="Fleet board" className="flex flex-col text-sm">
      <div className={cn(COLUMNS, "px-3 pb-1 text-xs text-muted-foreground")}>
        <span>Fleet</span>
        <span>Manager</span>
        <Tip text={STATUS_HEADER_TEXT}>
          <span tabIndex={0} aria-label={`Status: ${STATUS_HEADER_TEXT}`} className={cn(FOCUS, "w-[11rem]")}>
            Status
          </span>
        </Tip>
        <span>Spend</span>
        <span>Polling</span>
        <span />
        <span />
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {[...listed, ...(showQuiet ? quiet : [])].map((card) => (
          <BoardLine key={card.repo} card={card} now={now} selected={selected === card.repo} onToggle={() => toggle(card.repo)} />
        ))}
      </ul>
      {quiet.length > 0 ? (
        <button type="button" aria-expanded={showQuiet} className={cn(FOCUS, "self-start px-3 pt-2 text-xs text-muted-foreground hover:text-foreground")} onClick={() => setShowQuiet(!showQuiet)}>
          {quietLabel(quiet.length)}
        </button>
      ) : null}
    </section>
  );
}

function BoardLine({ card, now, selected, onToggle }: { card: FleetCardView; now: string; selected: boolean; onToggle(): void }) {
  const openFleetTab = useOpenFleetTab();
  const flags = flagsOf(card, now);
  const worst = worstFlag(flags);
  const tracker = trackerOf(card.tracker);
  const spend = spendText(card);
  return (
    <li aria-label={`Fleet ${card.repo}`} className={cn(COLUMNS, "relative cursor-pointer px-3 py-2 hover:bg-accent", selected && "bg-accent")} onClick={lineClick(onToggle)}>
      {worst !== null ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1 rounded-l-md", TONE_FILL[FLAG_TONES[worst]])} /> : null}
      <span className="flex min-w-0 items-center gap-2">
        <ServiceLogo service={card.forge} />
        <button type="button" aria-pressed={selected} className={cn(FOCUS, "truncate font-medium")} onClick={onToggle}>
          {card.repo}
        </button>
        {tracker !== null ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ServiceLogo service={tracker.service} />
            {tracker.key}
          </span>
        ) : null}
      </span>
      <ManagerCellView card={card} now={now} />
      <StatusCell card={card} />
      <SpendCell card={card} spend={spend} />
      <PollingCellView card={card} now={now} />
      <FixCell card={card} flags={flags} />
      <button type="button" aria-label={`Open the Fleet tab of ${card.repo}`} className={cn(FOCUS, "flex size-8 items-center justify-center text-muted-foreground hover:text-foreground")} onClick={() => openFleetTab({ managerThreadId: card.managerThreadId, fleet: card.repo })}>
        <Glyph name={ICONS.fleetTab} className="size-4" />
      </button>
    </li>
  );
}

/** The manager's spend, and under it the other fleets its thread holds, whose spend it is too. */
function SpendCell({ card, spend }: { card: FleetCardView; spend: string | null }) {
  const shared = sharedText(card);
  if (spend === null || shared === null) return <span className="text-xs tabular-nums text-muted-foreground">{spend}</span>;
  return (
    <Tip text={`${spend} ${shared}`}>
      <span tabIndex={0} aria-label={`${spend} ${shared}`} className={cn(FOCUS, "flex min-w-0 flex-col text-xs text-muted-foreground")}>
        <span className="tabular-nums">{spend}</span>
        <span className="truncate text-[11px]">{shared}</span>
      </span>
    </Tip>
  );
}

function ManagerCellView({ card, now }: { card: FleetCardView; now: string }) {
  const cell = managerCell(card.manager, now);
  const icon = cell.state === "working" ? ICONS.managerWorking : cell.state === "idle" ? ICONS.managerIdle : ICONS.managerNone;
  return (
    <Tip text={cell.words}>
      <span tabIndex={0} className={cn(FOCUS, "flex items-center gap-1 text-xs tabular-nums", TONE_TEXT[MANAGER_TONES[cell.state]])}>
        <Glyph name={icon} label={cell.words} spin={cell.state === "working"} />
        {cell.duration !== null ? <span className="text-muted-foreground">{cell.duration}</span> : null}
      </span>
    </Tip>
  );
}


/** The four Status slots, each a fixed width so a count sits under the same count on every line. */
export function StatusCell({ card }: { card: FleetCardView }) {
  return (
    <span className="flex w-[11rem]">
      {statusSlots(card).map((slot) => (
        <span key={slot.key} className="w-11">
          {slot.count !== null ? (
            <Tip text={slot.label}>
              <span tabIndex={0} aria-label={slot.label} className={cn(FOCUS, "inline-flex items-center gap-1 text-xs tabular-nums", TONE_TEXT[COUNT_TONES[slot.key]], slot.key === "waiting" && "font-semibold")}>
                <Glyph name={ICONS[slot.key]} />
                {slot.count}
              </span>
            </Tip>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function PollingCellView({ card, now }: { card: FleetCardView; now: string }) {
  const cell = pollingCell(card, now);
  if (cell === null) return <span />;
  if (cell.kind === "never") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Glyph name={ICONS.neverPolled} />
        {cell.text}
      </span>
    );
  }
  return <span className="text-xs tabular-nums text-warning-text">{cell.text}</span>;
}

/** The fleet's first problem or warning as a coloured verb, or a red ✕ where nothing on the page fixes it, then `+N`; every sentence on hover. */
function FixCell({ card, flags }: { card: FleetCardView; flags: readonly Flag[] }) {
  const fixOf = useFix(card);
  const first = flags[0];
  const icon = first === undefined ? null : fixIcon(first);
  if (first === undefined || icon === null) return <span />;
  const sentences = flags.map((flag) => flag.sentence).join("\n");
  const tone = TONE_TEXT[FLAG_TONES[first.kind]];
  const summary = flagSummary(flags) ?? "";
  const run = fixOf(first);
  const hover = <span className="whitespace-pre-line">{sentences}</span>;
  if (first.verb !== null && run !== null) {
    return (
      <Tip text={hover}>
        <button type="button" aria-label={flags.map((flag) => flag.sentence).join("; ")} className={cn(FOCUS, "flex items-center gap-1 text-xs font-medium", tone)} onClick={run}>
          <Glyph name={icon} />
          {summary}
        </button>
      </Tip>
    );
  }
  return (
    <Tip text={hover}>
      <span tabIndex={0} aria-label={flags.map((flag) => flag.sentence).join("; ")} className={cn(FOCUS, "flex items-center gap-1 text-xs font-medium", tone)}>
        <Glyph name={icon} />
        {summary}
      </span>
    </Tip>
  );
}

/**
 * The board on a phone: one line per fleet with its short name, its fix as a touch-sized icon and its non-zero counts,
 * three shown and the rest folded.
 */
export function PhoneBoard({ cards, now, selected, onSelect, nameOf }: BoardProps & { nameOf(fleet: string): string }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = phoneBoard(cards, now, expanded);
  return (
    <section aria-label="Fleet board" className="flex flex-col text-sm">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {shown.map((card) => (
          <PhoneLine key={card.repo} card={card} shortName={nameOf(card.repo)} now={now} selected={selected === card.repo} onToggle={() => onSelect(selected === card.repo ? null : card.repo)} />
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" className={cn(FOCUS, "self-start px-3 py-3 text-xs text-muted-foreground")} onClick={() => setExpanded(true)}>
          {moreLabel(more)}
        </button>
      ) : null}
    </section>
  );
}

function PhoneLine({ card, shortName, now, selected, onToggle }: { card: FleetCardView; shortName: string; now: string; selected: boolean; onToggle(): void }) {
  const fixOf = useFix(card);
  const flags = flagsOf(card, now);
  const first = flags[0];
  const worst = worstFlag(flags);
  const sentence = flags.map((flag) => flag.sentence).join("; ");
  const run = first === undefined ? null : fixOf(first);
  const icon = phoneFlagIcon(flags) ?? ICONS.review;
  return (
    <li aria-label={`Fleet ${card.repo}`} className={cn("relative flex min-h-11 items-center gap-2 px-3", selected && "bg-accent")} onClick={lineClick(onToggle)}>
      {worst !== null ? <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1 rounded-l-md", TONE_FILL[FLAG_TONES[worst]])} /> : null}
      <ServiceLogo service={card.forge} />
      <button type="button" aria-pressed={selected} aria-label={card.repo} className={cn(FOCUS, "min-w-0 truncate py-3 text-left font-medium")} onClick={onToggle}>
        {shortName}
      </button>
      {worst !== null ? (
        run !== null ? (
          <button type="button" aria-label={sentence} className={cn(FOCUS, "flex size-11 shrink-0 items-center justify-center", TONE_TEXT[FLAG_TONES[worst]])} onClick={run}>
            <Glyph name={icon} className="size-4" />
          </button>
        ) : (
          <span className={cn("flex size-11 shrink-0 items-center justify-center", TONE_TEXT[FLAG_TONES[worst]])}>
            <Glyph name={icon} label={sentence} className="size-4" />
          </span>
        )
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {statusSlots(card)
          .filter((slot) => slot.count !== null)
          .map((slot) => (
            <span key={slot.key} aria-label={slot.label} className={cn("inline-flex items-center gap-1 text-xs tabular-nums", TONE_TEXT[COUNT_TONES[slot.key]], slot.key === "waiting" && "font-semibold")}>
              <Glyph name={ICONS[slot.key]} />
              {slot.count}
            </span>
          ))}
      </span>
    </li>
  );
}
