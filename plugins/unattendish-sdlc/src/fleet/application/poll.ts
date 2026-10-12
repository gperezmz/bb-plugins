// One poll of one fleet: read what changed in its sources, sort every change
// into woken, echo, out of scope or held, and send the manager one wake.
import { byTimeThenKey, deriveChanges, outageKind, partitionRevisit, type Derived } from "../domain/changes";
import { classify } from "../domain/echo";
import { formatRepo, repoId, trackerSource, urlUnder } from "../domain/identity";
import type { Change, Disposition, NotWatched, RefusedWhy, Registration, ServiceKind, SourceRole, UnreadableWhy, WatchedItem } from "../domain/model";
import { messageOf, redact } from "../domain/redact";
import { catchUp, effectiveInterval, UNREADABLE_POLLS } from "../domain/registration";
import { formatWake } from "../domain/wake";
import {
  HttpError,
  type Clock,
  type Credentials,
  type DashboardEvents,
  type Http,
  type LedgerRow,
  type ManagerChannel,
  type ManifestFiles,
  type PollRecord,
  type ResolvedSource,
  type ServiceAdapter,
  type SourceOutage,
  type Store,
  type StoredFleet,
  type StoredWake,
  type ThreadDirectory,
} from "./ports";
import { observeManifest } from "./observe";
import { assessWatching, forgeServiceOf, refusedNotWatched, type Watching } from "./watching";

export interface PollDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly channel: ManagerChannel;
  readonly credentials: Credentials;
  readonly http: Http;
  readonly adapters: Readonly<Record<ServiceKind, ServiceAdapter>>;
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
  /** Tells the open bb windows what a poll changed. */
  readonly events: DashboardEvents;
  readonly log: { warn(message: string): void };
  /** Per credential prefix, the time (epoch milliseconds) before which the service asked to be left alone. Lives in memory: a restart forgets it and the first refusal sets it again. */
  readonly rateLimits: Map<string, number>;
}

export interface PollOptions {
  /** Read the state of watched items the cursor does not know yet and nothing else: no changes, no wake. */
  readonly stateOnly?: boolean;
  readonly signal?: AbortSignal;
}

export interface PollResult {
  readonly polled: boolean;
  /** Changes sent to the manager in this poll's wake. */
  readonly woke: number;
  readonly echoes: number;
  readonly outOfScope: number;
  /** Changes held because no manager holds the fleet. */
  readonly held: number;
  readonly delivery: "none" | "sent" | "queued" | "amended" | "refused";
}

const NOTHING: PollResult = { polled: false, woke: 0, echoes: 0, outOfScope: 0, held: 0, delivery: "none" };
/** What counts as already settled: a change with one of these dispositions is never handled twice. */
const SETTLED: ReadonlySet<Disposition["kind"]> = new Set(["wake", "echo", "out-of-scope"]);

const rowOf = (change: Change, disposition: Disposition, seenAt: string): Omit<LedgerRow, "wakeId"> => ({
  key: change.key,
  role: change.role,
  ref: change.ref,
  url: change.url,
  kind: change.kind,
  label: change.label,
  actor: change.actor,
  at: change.at,
  seenAt,
  disposition: disposition.kind,
  rule: disposition.kind === "echo" ? disposition.rule : disposition.kind === "held" ? disposition.reason : null,
});

interface SourceRead {
  readonly role: SourceRole;
  readonly resolved: ResolvedSource;
  readonly derived: Derived;
  readonly since: string;
}

/** What a poll found of a source whose adapter it asked to read and that gave an answer other than a rate limit. */
interface Finding {
  readonly prefix: string;
  /** The service answered 401. */
  readonly refused: boolean;
  /** How the source's read counts toward its not being watched, as `outageKind` says, or null when it does not. */
  readonly unreadable: Exclude<RefusedWhy, "refused"> | null;
}

interface Reading {
  readonly reads: SourceRead[];
  readonly notWatched: NotWatched[];
  /**
   * By role, what the poll found of each source it asked to read and that gave an answer other than a rate limit. A
   * source absent here, not asked or only told to wait, says nothing of whether it is readable.
   */
  readonly findings: Partial<Record<SourceRole, Finding>>;
  readonly expiries: Record<string, string | null>;
}

/** Reads each of the fleet's sources: the forge, then the tracker where it is a service of its own. */
async function readSources(deps: PollDeps, fleet: StoredFleet, watching: Watching, now: string, options: PollOptions): Promise<Reading> {
  const registration = fleet.registration;
  const repo = repoId(registration.repo);
  const stateOnly = options.stateOnly === true;
  const signal = options.signal ?? AbortSignal.timeout(120_000);
  const secrets = () => deps.credentials.secrets();
  const nowMs = Date.parse(now);
  const limited = new Set<string>();
  const findings: Partial<Record<SourceRole, Finding>> = {};
  const reading: Reading = { reads: [], notWatched: [...watching.notWatched], findings, expiries: { ...fleet.expiries } };

  for (const resolved of [watching.forge, watching.tracker]) {
    if (resolved === null) continue;
    const role = resolved.source.role;
    const cursor = deps.store.getCursor(repo, role);
    const wanted = watching.watched.items.filter((item) => item.role === role);
    const watchedRefs = new Set(wanted.map((item) => item.ref));
    const known = new Set(Object.keys(cursor?.items ?? {}));
    const items: WatchedItem[] = stateOnly
      ? wanted.filter((item) => !known.has(`${role}:${item.ref}`))
      : [...wanted, ...partitionRevisit(cursor, role, registration.labels, watchedRefs)];
    if (stateOnly && items.length === 0) continue;
    const since = cursor?.since ?? registration.registeredAt;

    const prefix = resolved.credential.prefix;
    const notBefore = deps.rateLimits.get(prefix);
    if (notBefore !== undefined && notBefore > nowMs) {
      if (!limited.has(prefix)) deps.store.recordFailedRead(repo, { at: now, role, ref: null, reason: `${prefix} is rate limited; not read until ${new Date(notBefore).toISOString()}` });
      limited.add(prefix);
      continue;
    }
    deps.rateLimits.delete(prefix);

    let session;
    try {
      session = deps.http.session(resolved.credential, await deps.credentials.token(resolved.credential));
    } catch (error) {
      // Why the fleet is not watched is already in `notWatched`, from `assessWatching`.
      deps.store.recordFailedRead(repo, { at: now, role, ref: null, reason: messageOf(error, secrets()) });
      continue;
    }
    let derived: Derived | null = null;
    try {
      const outcome = await deps.adapters[resolved.credential.service].read({
        source: resolved.source,
        http: session,
        items,
        watchedRefs,
        labels: registration.labels,
        operator: registration.operator,
        since,
        scanPartition: !stateOnly,
        stateOnly,
        signal,
      });
      derived = deriveChanges({ role, prev: cursor, outcome, watchedRefs, labels: registration.labels, startedAt: now, firstSince: registration.registeredAt, stateOnly });
      findings[role] = { prefix, refused: false, unreadable: outageKind(outcome) };
    } catch (error) {
      const kind = error instanceof HttpError ? unreadableOf(error) : error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "unreachable" : null;
      const refused = error instanceof HttpError && error.kind === "auth";
      // Any other error read nothing, the listing included, so it counts as a failed listing.
      if (!(error instanceof HttpError && error.kind === "rate-limit")) findings[role] = { prefix, refused, unreadable: kind ?? (refused ? null : "listing-failed") };
      if (error instanceof HttpError && error.kind === "rate-limit" && error.retryAfterMs !== null) deps.rateLimits.set(prefix, nowMs + error.retryAfterMs);
      deps.store.recordFailedRead(repo, { at: now, role, ref: null, reason: messageOf(error, secrets()) });
    }
    const requests = session.drainRequests().map((request) => ({ ...request, path: redact(request.path, secrets()) }));
    const record: PollRecord = { at: now, role, requests, counted: requests.filter((r) => r.counted).length, ok: derived !== null };
    deps.store.recordPoll(repo, record);
    const expiry = session.expiresAt();
    if (expiry !== null) reading.expiries[resolved.credential.prefix] = expiry;
    if (derived !== null) {
      for (const failure of derived.failures) deps.store.recordFailedRead(repo, { at: now, role, ref: failure.ref, reason: redact(failure.reason, secrets()) });
      reading.reads.push({ role, resolved, derived, since });
    }
  }
  return reading;
}

/** The larger of two lengths of time, either of which may be absent. */
const larger = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * How an error an adapter let through says its source is unreadable: a 403 forbids, no answer or a 5xx is
 * unreachable, a 404 finds nothing, and a redirect off the source lies outside the fleet.
 */
const unreadableOf = (error: HttpError): UnreadableWhy | null => {
  switch (error.kind) {
    case "forbidden":
      return "forbidden";
    case "network":
    case "server":
      return "unreachable";
    case "not-found":
      return "not-found";
    case "outside-host":
      return "outside-fleet";
    default:
      return null;
  }
};

/**
 * A source's outage after this poll: a 401 refuses its credential at once,
 * from this poll; `UNREADABLE_POLLS` polls in a row that found it unreadable
 * refuse it from the first of them. A source the poll found nothing of (not
 * asked to read, or only told to wait) keeps its outage as it was, whatever
 * the other source did. Undefined once the source reads.
 */
const outageOf = (stored: SourceOutage | undefined, finding: Finding | undefined, now: string): SourceOutage | undefined => {
  if (finding === undefined) return stored;
  // An outage stored under another credential's prefix (a copy of the other source's, from a fleet migrated from one
  // outage per fleet) is not this source's: its streak, its time and what was announced of it do not carry over.
  const before = stored?.refused != null && stored.refused.prefix !== finding.prefix ? undefined : stored;
  const streak = before?.unreadablePolls ?? 0;
  const unreadablePolls = finding.unreadable !== null ? streak + 1 : 0;
  const unreadableSince = finding.unreadable !== null ? (streak > 0 ? (before?.unreadableSince ?? now) : now) : null;
  const cause: { readonly since: string; readonly why: RefusedWhy } | null = finding.refused
    ? { since: now, why: "refused" }
    : finding.unreadable !== null && unreadablePolls >= UNREADABLE_POLLS
      ? { since: unreadableSince ?? now, why: finding.unreadable }
      : null;
  const refused = cause === null ? null : { since: before?.refused?.since ?? cause.since, prefix: finding.prefix, why: cause.why, announced: before?.refused?.announced ?? false };
  return unreadablePolls === 0 && refused === null ? undefined : { unreadablePolls, unreadableSince, refused };
};

/** The roles of the fleet's sources: its forge, and its tracker where that is a service of its own. */
const rolesOf = (registration: Registration): SourceRole[] => (trackerSource(registration.tracker) === null ? ["forge"] : ["forge", "tracker"]);

/**
 * Polls one fleet. A failure of a service is recorded and leaves its cursor
 * where it was; only a failure of the store propagates.
 */
export async function pollFleet(deps: PollDeps, repo: string, options: PollOptions = {}): Promise<PollResult> {
  const result = await runPoll(deps, repo, options);
  if (result.polled) deps.events.boardChanged();
  return result;
}

async function runPoll(deps: PollDeps, repo: string, options: PollOptions): Promise<PollResult> {
  const fleet = deps.store.getFleet(repo);
  if (fleet === null) return NOTHING;
  const registration = fleet.registration;
  const now = deps.clock.now().toISOString();
  const stateOnly = options.stateOnly === true;
  const hasManager = (await deps.threads.state(registration.managerThreadId)) === "live";

  const watching = await assessWatching(deps, registration);
  const reading = await readSources(deps, fleet, watching, now, options);
  const notWatched = [...reading.notWatched];
  observeManifest(deps, registration, forgeServiceOf(watching), watching.manifest, Object.assign({}, ...reading.reads.map((read) => read.derived.nextCursor.items)), now);

  const outages: Partial<Record<SourceRole, SourceOutage>> = {};
  for (const role of rolesOf(registration)) {
    const outage = outageOf(fleet.outages[role], reading.findings[role], now);
    if (outage !== undefined) outages[role] = outage;
  }
  notWatched.push(...refusedNotWatched(outages));

  const cursors = reading.reads.map((read) => ({ role: read.role, cursor: read.derived.nextCursor }));
  const pollState = (heldSince: string | null, pendingCatchUpMs = fleet.pendingCatchUpMs) => ({
    lastPolledAt: now,
    notWatched,
    unreadableRows: watching.unreadableRows,
    outsideLinks: watching.watched.outside,
    expiries: reading.expiries,
    heldSince,
    outages,
    pendingCatchUpMs,
  });

  if (stateOnly) {
    if (cursors.length > 0 && fleet.lastPolledAt !== null) deps.store.commit({ repo, at: fleet.lastPolledAt, cursors });
    return { ...NOTHING, polled: true };
  }

  // ---- sort every change ----
  const candidates = reading.reads.flatMap((read) => read.derived.changes.map((change) => ({ change, read })));
  const observations = reading.reads.flatMap((read) => read.derived.outOfScope.map((observation) => ({ observation, read })));
  const known = deps.store.dispositions(repo, [...candidates.map((c) => c.change.key), ...observations.map((o) => o.observation.key)]);

  let echoes = 0;
  let outOfScope = 0;
  let held = 0;
  const toWake = new Map<string, Change>();
  for (const { change, read } of candidates) {
    const was = known.get(change.key);
    if (was !== undefined && SETTLED.has(was)) continue;
    if (!urlUnder(read.resolved.source, change.url)) {
      deps.store.recordFailedRead(repo, { at: now, role: change.role, ref: change.ref, reason: "the change names an item outside the fleet" });
      continue;
    }
    const disposition = classify(change, registration);
    if (disposition.kind === "echo") {
      deps.store.recordChange(repo, rowOf(change, disposition, now));
      echoes += 1;
    } else if (!hasManager) {
      if (was !== "held") held += 1;
      deps.store.recordChange(repo, rowOf(change, { kind: "held", reason: "no manager" }, now));
    } else {
      toWake.set(change.key, change);
    }
  }
  for (const { observation } of observations) {
    if (known.has(observation.key)) continue;
    deps.store.recordChange(repo, {
      key: observation.key,
      role: observation.role,
      ref: observation.ref,
      url: observation.url,
      kind: "updated",
      label: null,
      actor: null,
      at: observation.at,
      seenAt: now,
      disposition: "out-of-scope",
      rule: null,
    });
    outOfScope += 1;
  }

  const heldSince = hasManager ? null : (fleet.heldSince ?? (held > 0 ? now : null));
  if (!hasManager) {
    // Cursors hold: the manager that takes the fleet over reads these changes again, from the ledger and the cursor.
    deps.store.savePollState(repo, pollState(heldSince));
    return { polled: true, woke: 0, echoes, outOfScope, held, delivery: "none" };
  }

  // The changes held while no manager held the fleet go out in the first wake a manager gets; the ledger holds them though the fleet's `heldSince` does not (a repository registered again).
  const heldNow = deps.store.heldChanges(repo);
  const heldFrom = fleet.heldSince ?? heldNow[0]?.at ?? null;
  for (const change of heldNow) if (!toWake.has(change.key)) toWake.set(change.key, change);
  const changes = [...toWake.values()].sort(byTimeThenKey);

  // One wake says one source's refusal; another not yet said goes in the next poll's wake.
  const announce = rolesOf(registration).find((role) => outages[role]?.refused != null && !outages[role]!.refused!.announced) ?? null;
  if (changes.length === 0 && announce === null) {
    if (cursors.length > 0) deps.store.commit({ repo, at: now, cursors });
    deps.store.savePollState(repo, pollState(null));
    return { polled: true, woke: 0, echoes, outOfScope, held, delivery: "none" };
  }

  const interval = effectiveInterval(registration);
  // A catch-up a refused wake carried is still owed: that poll's time is the last poll's now, so the gap no longer shows it.
  const catchUpMs = larger(fleet.pendingCatchUpMs, catchUp(fleet.lastPolledAt, now, interval));
  const earliest = reading.reads.map((read) => read.since).sort()[0] ?? registration.registeredAt;
  const since = heldFrom !== null && heldNow.length > 0 && heldFrom < earliest ? heldFrom : earliest;
  const announced = announce === null ? null : outages[announce]!.refused!;
  const notWatchedLine = announced === null ? null : { since: announced.since, prefix: announced.prefix, why: announced.why };

  const delivery = await deliver(deps, fleet, { changes, since, catchUpMs, heldSince: heldNow.length > 0 ? heldFrom : null, notWatched: notWatchedLine, now });
  if (delivery.result === "refused") {
    // The same changes, and the catch-up, are offered again at the next poll: no cursor moves.
    deps.store.savePollState(repo, pollState(fleet.heldSince, catchUpMs));
    return { polled: true, woke: 0, echoes, outOfScope, held, delivery: "refused" };
  }
  const keys = changes.map((change) => change.key);
  for (const change of changes) deps.store.recordChange(repo, rowOf(change, { kind: "wake" }, now));
  if (keys.length > 0) deps.store.markWoke(repo, delivery.wakeId, keys);
  if (cursors.length > 0) deps.store.commit({ repo, at: now, cursors });
  deps.store.savePollState(repo, pollState(null, null));
  if (announce !== null) deps.store.markRefusedAnnounced(repo, announce);
  return { polled: true, woke: changes.length, echoes, outOfScope, held, delivery: delivery.result };
}

interface Wake {
  readonly changes: readonly Change[];
  readonly since: string;
  readonly catchUpMs: number | null;
  readonly heldSince: string | null;
  readonly notWatched: StoredWake["notWatched"];
  readonly now: string;
}

/** Sends the wake, or adds its changes to the one still waiting in bb's queue. */
async function deliver(
  deps: PollDeps,
  fleet: StoredFleet,
  wake: Wake,
): Promise<{ readonly result: "refused" } | { readonly result: "sent" | "queued" | "amended"; readonly wakeId: number }> {
  const registration = fleet.registration;
  const repo = repoId(registration.repo);
  const thread = registration.managerThreadId;

  const open = deps.store.openWake(repo);
  if (open !== null && open.threadId === thread && open.queuedMessageId !== null) {
    const merged = [...deps.store.wakeChanges(repo, open.id), ...wake.changes].sort(byTimeThenKey);
    const heldSince = open.heldSince ?? wake.heldSince;
    const notWatched = wake.notWatched ?? open.notWatched;
    const catchUpMs = larger(open.catchUpMs, wake.catchUpMs);
    const text = formatWake({ since: open.since, changes: merged, catchUpMs, heldSince, notWatched });
    const amended = await deps.channel.amend(thread, open.queuedMessageId, text);
    if (amended === "amended") {
      deps.store.updateWake(repo, open.id, { kind: merged.length > 0 ? "changes" : "not-watched", catchUpMs, heldSince, notWatched });
      return { result: "amended", wakeId: open.id };
    }
    if (amended !== "gone") return { result: "refused" };
    // It left the queue since: its turn has started, so these changes go in a new wake.
    deps.store.markDispatched(open.queuedMessageId, wake.now);
  }

  const text = formatWake({ since: wake.since, changes: wake.changes, catchUpMs: wake.catchUpMs, heldSince: wake.heldSince, notWatched: wake.notWatched });
  const sent = await deps.channel.send(thread, text);
  if (sent.delivered === "refused") {
    deps.log.warn(`bb refused a wake for ${formatRepo(registration.repo)}: ${sent.reason}`);
    return { result: "refused" };
  }
  const stored = deps.store.createWake(repo, {
    kind: wake.changes.length === 0 ? "not-watched" : "changes",
    threadId: thread,
    queuedMessageId: sent.delivered === "queued" ? sent.queuedMessageId : null,
    queuedAt: wake.now,
    since: wake.since,
    catchUpMs: wake.catchUpMs,
    heldSince: wake.heldSince,
    notWatched: wake.notWatched,
    ...(sent.delivered === "sent" ? { dispatchedAt: wake.now } : {}),
  });
  return { result: sent.delivered, wakeId: stored.id };
}
