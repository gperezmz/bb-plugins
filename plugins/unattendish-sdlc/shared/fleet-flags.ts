// A fleet's problems and warnings, decided from its card alone: every problem the server flags is red and every warning
// amber, each with the fix that puts it right, in the order the fleet board shows the first of them.
import type { FleetCardView, HalfView, ProblemView, WarningView } from "@/src/fleet/application/views";
import { expiredLine, warningLine } from "./card-model";
import { ICONS } from "./look/icons";
import { COUNTS } from "./look/tones";

/** Where a flag is put right: the Fleet tab, the Connect popup for a half, the Connect popup renewing a credential, or nowhere on the page. */
export type FlagFix =
  | { readonly kind: "fleet-tab" }
  | { readonly kind: "connect"; readonly role: HalfView["role"] }
  | { readonly kind: "renew"; readonly role: HalfView["role"]; readonly accountId: string; readonly credentialId: string }
  | { readonly kind: "none" };

export interface Flag {
  readonly kind: "problem" | "warning";
  /** The full sentence. */
  readonly sentence: string;
  /** The coloured verb that fixes it; null for a flag nothing on the page fixes. */
  readonly verb: "Review" | "Connect…" | "Renew…" | null;
  readonly fix: FlagFix;
  /**
   * True for late or never-run polling: the polling cell already says it, so the fix column draws neither a verb nor
   * the ✕ that marks a problem with no fix.
   */
  readonly saidElsewhere: boolean;
}

/**
 * The order flags are shown in: the manifest, its unreadable rows, a half Connect… fixes, an expired token, a gone
 * manager, any other problem, an expiring token, polling.
 */
function rankOf(flag: Flag, code: string | null): number {
  if (code === "manifest-missing" || code === "manifest-unreadable") return 0;
  if (code === "unreadable-rows") return 1;
  if (flag.fix.kind === "connect") return 2;
  if (code === "token-expired") return 3;
  if (code === "manager-gone") return 4;
  if (flag.kind === "problem") return 5;
  if (flag.fix.kind === "renew") return 6;
  return 7;
}

function problemOf(problem: ProblemView, now: string): Flag {
  if (problem.code === "token-expired") {
    return { kind: "problem", sentence: expiredLine(problem.label, problem.expiresAt, now), verb: "Renew…", fix: problem.fix, saidElsewhere: false };
  }
  const fix: FlagFix = problem.fix.kind === "connect" ? { kind: "connect", role: problem.fix.role } : problem.fix.kind === "fleet-tab" ? { kind: "fleet-tab" } : { kind: "none" };
  const verb = fix.kind === "connect" ? "Connect…" : fix.kind === "fleet-tab" ? "Review" : null;
  return { kind: "problem", sentence: problem.text, verb, fix, saidElsewhere: false };
}

/** A warning as a flag; null for one the board does not show (sharing the agents' rate limit, which the Fleet tab's credential card says). */
function warningOf(warning: WarningView, now: string): Flag | null {
  if (warning.kind === "shares-rate-limit") return null;
  const line = warningLine(warning, now);
  if (warning.kind === "expires") {
    return { kind: "warning", sentence: `${line.label}: ${line.text}`, verb: "Renew…", fix: { kind: "renew", role: warning.role, accountId: warning.accountId, credentialId: warning.credentialId }, saidElsewhere: false };
  }
  return { kind: "warning", sentence: line.text, verb: null, fix: { kind: "none" }, saidElsewhere: true };
}

/** Every problem and warning of the fleet, in the order the board shows them. */
export function flagsOf(card: Pick<FleetCardView, "problems" | "warnings">, now: string): Flag[] {
  const ranked = [
    ...card.problems.map((problem) => ({ flag: problemOf(problem, now), code: problem.code as string | null })),
    ...card.warnings.flatMap((warning) => {
      const flag = warningOf(warning, now);
      return flag === null ? [] : [{ flag, code: null }];
    }),
  ].map((entry, at) => ({ ...entry, at, rank: rankOf(entry.flag, entry.code) }));
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map((entry) => entry.flag);
}

/**
 * What the fix column draws for the first flag: its verb's icon, a ✕ for a problem nothing on the page fixes, and
 * nothing for a flag the polling cell already says.
 */
export function fixIcon(flag: Flag): string | null {
  if (flag.saidElsewhere) return null;
  if (flag.fix.kind === "renew") return ICONS.renew;
  if (flag.fix.kind === "connect") return ICONS.connect;
  if (flag.fix.kind === "fleet-tab") return ICONS.review;
  return ICONS.noFix;
}

/**
 * The icon the Fleets page's narrow layout shows for a fleet's flags, its sentences on hover: ⚠ for a problem, a key for a warning a renewal
 * fixes, ⚠ for any other warning; null with no flag.
 */
export function narrowFlagIcon(flags: readonly Flag[]): string | null {
  const first = flags[0];
  if (first === undefined) return null;
  return first.kind === "warning" && first.fix.kind === "renew" ? ICONS.renew : ICONS.review;
}

/** The fleet's worst flag: `problem` where it has one, `warning` where it has only warnings, null with neither. */
export function worstFlag(flags: readonly Flag[]): "problem" | "warning" | null {
  if (flags.some((flag) => flag.kind === "problem")) return "problem";
  return flags.length > 0 ? "warning" : null;
}

/** The first flag's verb with how many more there are: `Review +2`. */
export function flagSummary(flags: readonly Flag[]): string | null {
  const first = flags[0];
  if (first === undefined) return null;
  return [first.verb, flags.length > 1 ? `+${flags.length - 1}` : null].filter((part) => part !== null).join(" ");
}

/** A quiet fleet: every Status count at zero, no problem and no warning. */
export function isQuiet(card: Pick<FleetCardView, "blocked" | "inFlight" | "waiting" | "landed" | "problems" | "warnings">, now: string): boolean {
  return COUNTS.every((count) => card[count] === 0) && flagsOf(card, now).length === 0;
}

/** A fleet's mark beside its name: the rows that wait on the operator, drawn in amber, and the dot for its worst flag. */
export interface FleetMark {
  /** Null when no row waits. */
  readonly count: number | null;
  /** Red for a problem, amber for a warning alone; null with neither. */
  readonly dot: "problem" | "warning" | null;
}

export function fleetMark(card: Pick<FleetCardView, "waiting" | "problems" | "warnings">, now: string): FleetMark {
  return { count: card.waiting > 0 ? card.waiting : null, dot: worstFlag(flagsOf(card, now)) };
}

/**
 * The order fleets are listed in: a problem, then a warning, then neither; most waiting first among each; ties in name
 * order. A comparator for `Array.sort`.
 */
export function byFlagsThenWaiting(now: string): (a: Pick<FleetCardView, "repo" | "waiting" | "problems" | "warnings">, b: Pick<FleetCardView, "repo" | "waiting" | "problems" | "warnings">) => number {
  const rank = (card: Pick<FleetCardView, "problems" | "warnings">): number => {
    const worst = worstFlag(flagsOf(card, now));
    return worst === "problem" ? 0 : worst === "warning" ? 1 : 2;
  };
  return (a, b) => rank(a) - rank(b) || b.waiting - a.waiting || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0);
}
