// `bb unattendish fleet ...`: the command line a manager (and the operator)
// reaches the plugin through. No command takes or prints a token: accounts
// and their tokens are added through Connect… on the Fleets page or in the
// plugin's settings section.
import { cliCommand, defineCli, PluginCliError, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import { FIELD_MAX, LEDGER_LIMIT } from "../application/dashboard";
import type { FleetStatus } from "../application/status";
import type { RegisterOutcome } from "../application/register";
import type { LedgerEntry, LedgerQuery } from "../application/ports";
import { droppedReason, isSkippedListing } from "../domain/dashboard";
import { MIN_INTERVAL_MS, validateInterval, type RegisterArgs } from "../domain/registration";

/** What the command line asks of the application. */
export interface FleetCliApp {
  register(thread: string, args: RegisterArgs): Promise<RegisterOutcome>;
  unregister(repo: string): boolean;
  status(): Promise<FleetStatus[]>;
  ledger(repo: string, query: LedgerQuery): LedgerEntry[];
  /** Sets the poll interval of a fleet, or back to the default with null. False when no fleet holds the repository. */
  setInterval(repo: string, intervalMs: number | null): boolean;
}

const DONE = ["woke", "echo", "out-of-scope", "held", "failed-read"] as const;

const json = (value: unknown) => JSON.stringify(value, null, 2);

const parseDuration = (text: string): number | null => {
  const match = /^(\d+)(ms|s|m|h)$/.exec(text.trim());
  if (match === null) return null;
  return Number(match[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"];
};

const describeOutcome = (outcome: RegisterOutcome): string => {
  switch (outcome.outcome) {
    case "registered":
    case "taken-over": {
      const watched = outcome.watched ? "watched" : `not fully watched: ${outcome.notWatched.map((r) => r.text).join("; ")}`;
      return outcome.outcome === "taken-over" ? `Registered, taking the fleet over from ${outcome.previousManager} (${watched})` : `Registered (${watched})`;
    }
    case "refused":
      return `Refused: thread ${outcome.holder} holds this repository`;
    case "unsupported":
      return `Unsupported contract version; this plugin speaks ${outcome.supported.join(", ")}`;
    case "invalid":
      return `Invalid: ${outcome.reason}`;
  }
};

const statusLines = (fleets: readonly FleetStatus[]): string => {
  if (fleets.length === 0) return "No fleet is registered.";
  return fleets
    .map((fleet) => {
      const lines = [
        `${fleet.repo}  tracker ${fleet.tracker}`,
        `  manager ${fleet.manager} (${fleet.managerState}), manifest ${fleet.manifest}`,
        `  last polled ${fleet.lastPolledAt ?? "never"}, every ${Math.round(fleet.intervalMs / 1000)} s, ${fleet.requestsThisHour} requests this hour`,
        ...fleet.accounts.map((a) => `  ${a.role} reads as ${a.account ?? "no account"}${a.needs === null ? "" : `: ${a.needs}`}`),
        ...fleet.credentials.map((c) => `  credential ${c.credential} (${c.role}, ${c.service}, ${c.auth})${c.expiresAt === null ? "" : `, expires ${c.expiresAt}`}${c.canWrite ? ", can write" : ""}${c.sharesAgentRateLimit ? ", shares the fleet's agents' rate limit" : ""}`),
        fleet.watched ? "  watched" : `  not watched: ${fleet.notWatched.map((r) => `${r.code}: ${r.text}`).join("; ")}`,
        ...(fleet.notWatchedSince === null ? [] : [`  not watched since ${fleet.notWatchedSince}`]),
        ...fleet.unreadableRows.map((r) => `  unreadable manifest row: ${r.section}, line ${r.line}: ${r.reason}`),
        ...fleet.outside.map((o) => `  outside the fleet, never fetched: ${o.text} (${o.section}, line ${o.line})`),
        ...(fleet.heldSince === null ? [] : [`  changes held since ${fleet.heldSince}: no manager holds the fleet`]),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
};

/** A poll prints this many of its requests; the rest are counted in `requestsOmitted`. */
const REQUESTS_SHOWN = 5;

const clip = (text: string): string => (text.length <= FIELD_MAX ? text : `${text.slice(0, FIELD_MAX - 1)}…`);
const clipOrNull = (text: string | null): string | null => (text === null ? null : clip(text));

/** A ledger entry as the command line prints it: every string bounded, and a poll's requests cut to the first few. */
export const boundEntry = (entry: LedgerEntry): LedgerEntry & { readonly requestsOmitted?: number } => {
  switch (entry.type) {
    case "change": {
      const { row } = entry;
      return { type: "change", row: { ...row, ref: clipOrNull(row.ref), url: clipOrNull(row.url), label: clipOrNull(row.label), actor: clipOrNull(row.actor), rule: clipOrNull(row.rule), key: clip(row.key) } };
    }
    case "wake":
      return { type: "wake", wake: { ...entry.wake, threadId: clip(entry.wake.threadId), queuedMessageId: clipOrNull(entry.wake.queuedMessageId) } };
    case "poll": {
      const shown = entry.poll.requests.slice(0, REQUESTS_SHOWN).map((request) => ({ ...request, method: clip(request.method), path: clip(request.path) }));
      const omitted = entry.poll.requests.length - shown.length;
      return { type: "poll", poll: { ...entry.poll, requests: shown }, ...(omitted > 0 ? { requestsOmitted: omitted } : {}) };
    }
    case "failed read":
      return { ...entry, ref: clipOrNull(entry.ref), reason: clip(entry.reason) };
  }
};

type PrintedEntry = ReturnType<typeof boundEntry>;

const ledgerLines = (entries: readonly PrintedEntry[]): string => {
  if (entries.length === 0) return "The ledger holds nothing for this.";
  return entries
    .map((entry) => {
      switch (entry.type) {
        case "change": {
          const row = entry.row;
          if (isSkippedListing(row)) return `${row.seenAt}  ${droppedReason(row) ?? "out of scope"}  listed ${row.window.from} to ${row.window.to}, reached ${row.at}`;
          const label = row.label === null ? "" : ` ${row.label}`;
          const rule = row.rule === null ? "" : ` (${row.rule})`;
          return `${row.seenAt}  ${row.ref} ${row.kind}${label} by ${row.actor ?? "unknown"}: ${row.disposition === "wake" ? "woke the manager" : row.disposition}${rule}  ${row.url}`;
        }
        case "wake":
          return `${entry.wake.queuedAt}  wake ${entry.wake.id} to ${entry.wake.threadId}, ${entry.wake.dispatchedAt === null ? "waiting in bb's queue" : `dispatched ${entry.wake.dispatchedAt}`}`;
        case "poll":
          return `${entry.poll.at}  poll of the ${entry.poll.role}: ${entry.poll.requests.length + (entry.requestsOmitted ?? 0)} requests, ${entry.poll.counted} counted against the rate limit${entry.poll.ok ? "" : ", failed"}`;
        case "failed read":
          return `${entry.at}  failed read of the ${entry.role}${entry.ref === null ? "" : ` ${entry.ref}`}: ${entry.reason}`;
      }
    })
    .join("\n");
};

export function createFleetCli(app: FleetCliApp): PluginCliRegistration {
  const printJson = { json: { type: "boolean", description: "Print one JSON object on stdout." } } as const;
  return defineCli({
    name: "unattendish",
    summary: "Unattendish: wakes a fleet's manager thread when its tracker or forge changes",
    commands: {
      "fleet register": cliCommand({
        summary: "Register this thread as the manager of a fleet (contract version 1)",
        description: "Run by a manager from its own thread. Every outcome exits 0 and prints one JSON object with `outcome` when --json is given: registered, taken-over, refused, unsupported or invalid.",
        options: {
          contract: { type: "integer", min: 0, max: 1_000_000, required: true, description: "The contract version the caller speaks." },
          repo: { type: "string", required: true, placeholder: "host/path", description: "The repository, as the manifest's first line spells it." },
          tracker: { type: "string", required: true, placeholder: "forge-issues|linear:<team>|jira:<site>/<project>", description: "The fleet's tracker." },
          manifest: { type: "string", required: true, placeholder: "path", description: "Absolute path of fleet/manifest.md; the file may not exist yet." },
          operator: { type: "string", required: true, description: "The operator's login on the tracker." },
          "label-spec": { type: "string", required: true, description: "The spec label." },
          "label-ready": { type: "string", required: true, description: "The ready label." },
          "label-in-progress": { type: "string", required: true, description: "The in-progress label." },
          "label-needs-input": { type: "string", required: true, description: "The needs-input label." },
          marker: { type: "string", required: true, description: "The text that ends every fleet comment." },
          "echo-actor": { type: "string", repeatable: true, description: "A separate bot account the fleet's agents act as; never the operator." },
          ...printJson,
        },
        async run({ options }, ctx) {
          if (ctx.threadId === undefined) throw new PluginCliError("register runs from a manager's own thread, and this invocation names none", { code: "no_thread" });
          const outcome = await app.register(ctx.threadId, {
            contract: options.contract,
            repo: options.repo,
            tracker: options.tracker,
            manifest: options.manifest,
            operator: options.operator,
            labelSpec: options["label-spec"],
            labelReady: options["label-ready"],
            labelInProgress: options["label-in-progress"],
            labelNeedsInput: options["label-needs-input"],
            marker: options.marker,
            echoActors: options["echo-actor"],
          });
          return { exitCode: 0, stdout: options.json ? json(outcome) : describeOutcome(outcome) };
        },
      }),
      "fleet unregister": cliCommand({
        summary: "Remove a fleet's registration",
        positionals: [{ name: "repo", description: "The repository: host/path.", required: true }],
        options: { ...printJson },
        run({ options, positionals }) {
          const removed = app.unregister(positionals.repo);
          const outcome = removed ? "unregistered" : "not-registered";
          return { exitCode: 0, stdout: options.json ? json({ outcome }) : removed ? "Unregistered." : "No fleet is registered for that repository." };
        },
      }),
      "fleet status": cliCommand({
        summary: "List each fleet: manager, last poll, interval, credentials, requests, and why it is not watched",
        options: { ...printJson },
        async run({ options }) {
          const fleets = await app.status();
          return { exitCode: 0, stdout: options.json ? json({ fleets }) : statusLines(fleets) };
        },
      }),
      "fleet ledger": cliCommand({
        summary: "Print the ledger of a fleet: what the plugin saw and what it did with it, for 30 days",
        positionals: [{ name: "repo", description: "The repository: host/path.", required: true }],
        options: {
          item: { type: "string", description: "Only this item: its reference (#163, ENG-212) or URL." },
          done: { type: "enum", values: DONE, description: "Only what was done: woke, echo, out-of-scope, held or failed-read." },
          limit: { type: "integer", min: 1, max: LEDGER_LIMIT, default: 200, description: `At most this many entries, newest first; no more than ${LEDGER_LIMIT}, which fit bb's output limit. A string is cut to ${FIELD_MAX} characters and a poll lists its first ${REQUESTS_SHOWN} requests (its count is whole).` },
          ...printJson,
        },
        run({ options, positionals }) {
          const entries = app.ledger(positionals.repo, {
            ...(options.item === undefined ? {} : { item: options.item }),
            ...(options.done === undefined ? {} : { done: options.done === "failed-read" ? "failed read" : options.done }),
            limit: options.limit,
          });
          const printed = entries.map(boundEntry);
          return { exitCode: 0, stdout: options.json ? json({ entries: printed }) : ledgerLines(printed) };
        },
      }),
      "fleet interval": cliCommand({
        summary: "Set how often a fleet is polled; at least 30 seconds",
        positionals: [
          { name: "repo", description: "The repository: host/path.", required: true },
          { name: "interval", description: "A duration such as 30s, 2m or 1h; `default` restores 2 minutes.", required: true },
        ],
        options: { ...printJson },
        run({ options, positionals }) {
          const ms = positionals.interval === "default" ? null : parseDuration(positionals.interval);
          if (positionals.interval !== "default" && ms === null) throw new PluginCliError(`"${positionals.interval}" is not a duration; use 30s, 2m or 1h`, { code: "invalid_value" });
          if (ms !== null) {
            const valid = validateInterval(ms);
            if (!valid.ok) throw new PluginCliError(valid.reason, { code: "interval_too_short", hint: `The floor is ${MIN_INTERVAL_MS / 1000} seconds.` });
          }
          if (!app.setInterval(positionals.repo, ms)) throw new PluginCliError("No fleet is registered for that repository", { code: "not_registered" });
          return { exitCode: 0, stdout: options.json ? json({ outcome: "interval-set", intervalMs: ms }) : ms === null ? "Back to the default interval." : `Polling every ${positionals.interval}.` };
        },
      }),
    },
  });
}
