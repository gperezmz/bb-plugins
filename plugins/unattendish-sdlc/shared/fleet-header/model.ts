// What the fleet header says, decided from the card alone: the manager, the four Status counts, the spend and the last
// action. The Fleet tab opens on the header, the Fleet chip's hover card shows it, and the fleet board draws the same
// cells on each line.
import type { ActionRecordView, FleetCardView } from "@/src/fleet/application/views";
import { ageLabel, formatMoney } from "@/shared/format";
import { itemTitle } from "@/shared/item-title";
import { COUNTS, type CountKey } from "@/shared/look/tones";

export interface ManagerCell {
  readonly state: FleetCardView["manager"]["state"];
  /** How long it has been idle; null while working, with no manager, or when bb does not say. */
  readonly duration: string | null;
  /** The state in words: the icon's accessible name and hover text. */
  readonly words: string;
}

/** The manager cell: its state, and how long it has been idle. The plugin cannot know how long a manager has been working. */
export function managerCell(manager: FleetCardView["manager"], now: string): ManagerCell {
  if (manager.state === "working") return { state: "working", duration: null, words: "Manager working" };
  if (manager.state === "none") return { state: "none", duration: null, words: "No manager: its thread is archived or gone" };
  const duration = manager.since === null ? null : ageLabel(manager.since, now);
  return { state: "idle", duration, words: duration === null ? "Manager idle" : `Manager idle for ${duration}` };
}

/** What each Status count is called, as its hover text and accessible name say it. */
const COUNT_WORDS: Readonly<Record<CountKey, string>> = { blocked: "blocked", inFlight: "in flight", waiting: "waiting on you", landed: "landed in the last 7 days" };

export interface StatusSlot {
  readonly key: CountKey;
  /** Null for a count of zero, whose slot stays empty and keeps its place. */
  readonly count: number | null;
  /** `6 waiting on you`. */
  readonly label: string;
}

/** The four Status slots, always in the same order. */
export function statusSlots(card: Pick<FleetCardView, CountKey>): StatusSlot[] {
  return COUNTS.map((key) => ({ key, count: card[key] > 0 ? card[key] : null, label: `${card[key]} ${COUNT_WORDS[key]}` }));
}

/** The spend cell: the manager's cost, or nothing where it is unknown. */
export function spendText(card: Pick<FleetCardView, "cost">): string | null {
  return card.cost === null ? null : formatMoney(card.cost.amount, card.cost.currency);
}

/** A line of what the operator did: `You answered #5 Which queue`. */
export function sentText(action: Pick<ActionRecordView, "kind" | "ref" | "what">): string {
  const verb = action.kind === "answer" ? "You answered" : action.kind === "grant" ? "You granted" : "You asked to build";
  return `${verb} ${itemTitle(action.ref, action.what)}`;
}

/** How long ago an action was seen done: `40m ago`. */
export function sentAgo(action: Pick<ActionRecordView, "doneAt" | "sentAt">, now: string): string {
  return `${ageLabel(action.doneAt ?? action.sentAt, now)} ago`;
}

/** The header's last action: `You answered #5 Which queue · done 40m ago`. */
export function lastActionText(action: Pick<ActionRecordView, "kind" | "ref" | "what" | "doneAt" | "sentAt">, now: string): string {
  return `${sentText(action)} · done ${sentAgo(action, now)}`;
}
