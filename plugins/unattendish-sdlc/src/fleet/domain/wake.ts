// The wake's text, as the contract gives it. Nothing written on a service
// reaches it: it is built from a closed list of change kinds, a reference, a
// login that passed a strict test, and a URL that passed another.
import type { Change } from "./model";

/** The first words of every wake. */
export const WAKE_HEADER = "From Unattendish Fleet:";

export interface WakeInput {
  /** The time the changes run from (ISO 8601 UTC). */
  readonly since: string;
  /** In the order the wake lists them. */
  readonly changes: readonly Change[];
  /** How long the plugin was away, when this wake is a catch-up. */
  readonly catchUpMs: number | null;
  /** When the first change was gathered while no manager held the fleet. */
  readonly heldSince: string | null;
  /** Since when the fleet has not been watched, and the credential prefix that failed. */
  readonly notWatched: { readonly since: string; readonly prefix: string } | null;
}

const ACTOR = /^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,99}$/;
const REF = /^[#!]?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const UNSAFE_URL_CHARACTERS = /[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL_RUNS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** The change as the contract words it: `commented`, `reviewed: approved`, `labelled ready`, `checks failed`. */
export const changeText = (change: Change): string => (change.label === null ? change.kind : `${change.kind} ${oneLine(change.label)}`);

/** The actor's login or account id; `unknown` for anything else, so no free text rides in a login. */
export const safeActor = (actor: string | null): string => (actor !== null && ACTOR.test(actor) ? actor : "unknown");

/** The two largest nonzero units of days, hours, minutes and seconds: `3d 2h`, `8h 12m`, `1m 30s`, `45s`. Under a second is `0s`. */
export const formatDuration = (ms: number): string => {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const units: readonly (readonly [string, number])[] = [
    ["d", Math.floor(total / 86_400)],
    ["h", Math.floor(total / 3600) % 24],
    ["m", Math.floor(total / 60) % 60],
    ["s", total % 60],
  ];
  const parts = units.filter(([, value]) => value > 0).slice(0, 2);
  return parts.length === 0 ? "0s" : parts.map(([unit, value]) => `${value}${unit}`).join(" ");
};

/** The wake: a first line naming the time, one line per change, then the closing lines that apply. */
export const formatWake = (input: WakeInput): string => {
  const lines = [input.changes.length === 0 ? `${WAKE_HEADER} no changes since ${input.since}` : `${WAKE_HEADER} changes since ${input.since}`];
  for (const change of input.changes) {
    const ref = REF.test(change.ref) ? change.ref : "unknown";
    lines.push(`${ref} ${changeText(change)} by ${safeActor(change.actor)} ${safeUrl(change.url)}`);
  }
  if (input.heldSince !== null) lines.push(`Gathered while no manager held the fleet, since ${input.heldSince}.`);
  if (input.catchUpMs !== null) lines.push(`Catch-up: the plugin was away for ${formatDuration(input.catchUpMs)}.`);
  if (input.notWatched !== null) lines.push(`Not watched since ${input.notWatched.since}: the credential for ${oneLine(input.notWatched.prefix)} was refused by the service.`);
  return lines.join("\n");
};

const oneLine = (text: string): string => text.replace(CONTROL_RUNS, " ").trim();

const safeUrl = (url: string): string => {
  if (UNSAFE_URL_CHARACTERS.test(url)) return "unknown";
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" ? url : "unknown";
  } catch {
    return "unknown";
  }
};
