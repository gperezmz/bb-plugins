// The rules of registering a fleet and of polling it on time: which
// arguments are valid, who may hold a repository, and how often it is read.
import { parseRepo, parseTracker } from "./identity";
import { CONTRACT_VERSION, type FleetLabels, type NotWatched, type RefusedWhy, type Registration } from "./model";

export const DEFAULT_INTERVAL_MS = 120_000;
/** The shortest interval a fleet may be polled at. */
export const MIN_INTERVAL_MS = 30_000;

/** What `bb unattendish fleet register` was called with. */
export interface RegisterArgs {
  readonly contract: number;
  readonly repo: string;
  readonly tracker: string;
  readonly manifest: string;
  readonly operator: string;
  readonly labelSpec: string;
  readonly labelReady: string;
  readonly labelInProgress: string;
  readonly labelNeedsInput: string;
  readonly marker: string;
  readonly echoActors: readonly string[];
}

export type Validated =
  | { readonly outcome: "unsupported"; readonly supported: number[] }
  | { readonly outcome: "invalid"; readonly reason: string }
  | { readonly outcome: "valid"; readonly fields: Omit<Registration, "managerThreadId" | "registeredAt" | "intervalMs"> };

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

const invalid = (reason: string): Validated => ({ outcome: "invalid", reason });

/**
 * Checks a registration against the contract: the contract version first,
 * and when it is spoken, every argument in the order the command lists them.
 * The text arguments are kept trimmed; a control character in one is invalid.
 */
export const validateRegistration = (args: RegisterArgs): Validated => {
  if (args.contract !== CONTRACT_VERSION) return { outcome: "unsupported", supported: [CONTRACT_VERSION] };

  const repo = parseRepo(args.repo);
  if (repo === null) return invalid(`--repo "${shown(args.repo)}" is not <host>/<path>`);
  const tracker = parseTracker(args.tracker);
  if (tracker === null) return invalid(`--tracker "${shown(args.tracker)}" is not forge-issues, linear:<team key> or jira:<site>/<project key>`);
  const manifest = args.manifest.trim();
  if (!(manifest.startsWith("/") || WINDOWS_DRIVE_PATH.test(manifest)) || CONTROL.test(manifest)) return invalid(`--manifest "${shown(args.manifest)}" is not an absolute path`);

  const texts: readonly (readonly [string, string])[] = [
    ["--operator", args.operator],
    ["--marker", args.marker],
    ["--label-spec", args.labelSpec],
    ["--label-ready", args.labelReady],
    ["--label-in-progress", args.labelInProgress],
    ["--label-needs-input", args.labelNeedsInput],
  ];
  for (const [name, value] of texts) {
    if (value.trim() === "") return invalid(`${name} is empty`);
    if (CONTROL.test(value)) return invalid(`${name} holds a control character or line break`);
  }

  const operator = args.operator.trim();
  const labels: FleetLabels = { spec: args.labelSpec.trim(), ready: args.labelReady.trim(), inProgress: args.labelInProgress.trim(), needsInput: args.labelNeedsInput.trim() };
  const named: readonly (readonly [string, string])[] = [
    ["--label-spec", labels.spec],
    ["--label-ready", labels.ready],
    ["--label-in-progress", labels.inProgress],
    ["--label-needs-input", labels.needsInput],
  ];
  for (const [at, [name, label]] of named.entries()) {
    const clash = named.slice(0, at).find(([, other]) => other.toLowerCase() === label.toLowerCase());
    if (clash !== undefined) return invalid(`${name} equals ${clash[0]}: the four labels must differ`);
  }

  const echoActors: string[] = [];
  for (const actor of args.echoActors) {
    const login = actor.trim();
    if (login === "") return invalid("--echo-actor is empty");
    if (CONTROL.test(login)) return invalid("--echo-actor holds a control character or line break");
    if (login.toLowerCase() === operator.toLowerCase()) {
      return invalid("--echo-actor equals --operator: every answer the operator writes would be dropped as an echo");
    }
    if (!echoActors.some((known) => known.toLowerCase() === login.toLowerCase())) echoActors.push(login);
  }

  return { outcome: "valid", fields: { repo, tracker, manifestPath: manifest, operator, labels, marker: args.marker.trim(), echoActors, contract: CONTRACT_VERSION } };
};

/** What registering does about the thread already holding the repository, if any. */
export type HolderDecision =
  | { readonly action: "register" }
  | { readonly action: "update" }
  | { readonly action: "take-over"; readonly previousManager: string }
  | { readonly action: "refuse"; readonly holder: string };

/**
 * Who may register a repository: its holder again (to update), anyone when
 * none holds it, a successor to a holder that is archived or gone, and no
 * one to a live holder. `holder` is the state of `existing`'s thread and is
 * null only when that thread is `thread` itself; for any other thread whose
 * state is unknown the registration is refused.
 */
export const decideHolder = (existing: { readonly managerThreadId: string } | null, thread: string, holder: "live" | "archived" | "gone" | null): HolderDecision => {
  if (existing === null) return { action: "register" };
  if (existing.managerThreadId === thread) return { action: "update" };
  if (holder === "archived" || holder === "gone") return { action: "take-over", previousManager: existing.managerThreadId };
  return { action: "refuse", holder: existing.managerThreadId };
};

export const validateInterval = (ms: number): { ok: true } | { ok: false; reason: string } => {
  if (!Number.isInteger(ms)) return { ok: false, reason: "the interval must be a whole number of milliseconds" };
  if (ms < MIN_INTERVAL_MS) return { ok: false, reason: `the interval may not be under the 30-second floor (${MIN_INTERVAL_MS} ms); ${ms} ms was given` };
  return { ok: true };
};

export const effectiveInterval = (registration: { readonly intervalMs: number | null }): number => registration.intervalMs ?? DEFAULT_INTERVAL_MS;

/** Whether a fleet last polled at `lastPolledAt` is to be polled at `now`. A fleet never polled, or with a time that cannot be read, is due. */
export const isDue = (lastPolledAt: string | null, now: string, intervalMs: number): boolean => {
  if (lastPolledAt === null) return true;
  const elapsed = Date.parse(now) - Date.parse(lastPolledAt);
  return Number.isNaN(elapsed) || elapsed >= intervalMs;
};

/** A gap since the last poll beyond this many intervals, and at least `AWAY_MIN_MS`, is the plugin having been away. */
const AWAY_INTERVALS = 3;
const AWAY_MIN_MS = 10 * 60_000;

/**
 * How long the plugin was away, when a poll at `now` follows one at
 * `lastPolledAt` after a gap longer than three intervals and ten minutes;
 * null for an ordinary gap, for a fleet never polled, and for times that
 * cannot be read.
 */
export const catchUp = (lastPolledAt: string | null, now: string, intervalMs: number): number | null => {
  if (lastPolledAt === null) return null;
  const gap = Date.parse(now) - Date.parse(lastPolledAt);
  return gap > Math.max(AWAY_INTERVALS * intervalMs, AWAY_MIN_MS) ? gap : null;
};

/** Polls in a row whose read of a source is unreadable, every read failed as `UnreadableWhy` says, before its fleet is not watched. */
export const UNREADABLE_POLLS = 3;

/** What became of the reads with the credential for `prefix`, in lower case, as the wake's closing line and the status both word it. */
export const refusedText = (prefix: string, why: RefusedWhy): string => {
  switch (why) {
    case "refused":
      return `the credential for ${prefix} was refused by the service`;
    case "forbidden":
      return `the credential for ${prefix} was forbidden to read what the fleet needs (403)`;
    case "unreachable":
      return `the service did not answer reads with the credential for ${prefix}`;
    case "not-found":
      return `the credential for ${prefix} could not find what the fleet needs (404)`;
    case "outside-fleet":
      return `everything the fleet reads with the credential for ${prefix} has moved outside its repository, project or team`;
  }
};

/** Why a fleet whose credential the service refused, or whose every read failed for `UNREADABLE_POLLS` polls, is not watched. */
export const credentialRefused = (prefix: string, why: RefusedWhy): NotWatched => {
  const text = refusedText(prefix, why);
  return { code: "credential-refused", text: `${text.charAt(0).toUpperCase()}${text.slice(1)}` };
};

const shown = (text: string): string => (text.length > 80 ? `${text.slice(0, 80)}…` : text).replace(CONTROL, " ");
