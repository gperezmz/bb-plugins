// One poll of one fleet: read what changed in its sources, sort every change
// into woken, echo, out of scope or held, and send the manager one wake.
import { byTimeThenKey, deriveChanges, partitionRevisit, unreadableKind, type Derived } from "../domain/changes";
import { classify } from "../domain/echo";
import { formatRepo, repoId, urlUnder } from "../domain/identity";
import type { Change, Disposition, NotWatched, RefusedWhy, ServiceKind, SourceRole, WatchedItem } from "../domain/model";
import { messageOf, redact } from "../domain/redact";
import { catchUp, credentialRefused, effectiveInterval, UNREADABLE_POLLS } from "../domain/registration";
import { formatWake } from "../domain/wake";
import {
  HttpError,
  type Clock,
  type Credentials,
  type Http,
  type LedgerRow,
  type ManagerChannel,
  type ManifestFiles,
  type PollRecord,
  type ResolvedSource,
  type ServiceAdapter,
  type Store,
  type StoredFleet,
  type StoredWake,
  type ThreadDirectory,
} from "./ports";
import { assessWatching, type Watching } from "./watching";

export interface PollDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly channel: ManagerChannel;
  readonly credentials: Credentials;
  readonly http: Http;
  readonly adapters: Readonly<Record<ServiceKind, ServiceAdapter>>;
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
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

interface Reading {
  readonly reads: SourceRead[];
  readonly notWatched: NotWatched[];
  readonly refusedPrefix: string | null;
  /** The first source whose read, every part of it, was forbidden or got no answer. */
  readonly unreadable: { readonly prefix: string; readonly why: "forbidden" | "unreachable" } | null;
  /** Whether any source's adapter was asked to read: a poll that asked none says nothing of whether a source is readable. */
  readonly attempted: boolean;
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
  const reading: Reading = { reads: [], notWatched: [...watching.notWatched], refusedPrefix: null, unreadable: null, attempted: false, expiries: { ...fleet.expiries } };
  let refusedPrefix: string | null = null;
  let unreadable: Reading["unreadable"] = null;
  let attempted = false;

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
    attempted = true;
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
      const kind = unreadableKind(outcome);
      if (kind !== null) unreadable ??= { prefix, why: kind };
    } catch (error) {
      if (error instanceof HttpError && error.kind === "auth") refusedPrefix = resolved.credential.prefix;
      const kind = error instanceof HttpError ? unreadableOf(error) : null;
      if (kind !== null) unreadable ??= { prefix, why: kind };
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
  return { ...reading, refusedPrefix, unreadable, attempted };
}

/** How an error an adapter let through says its source is unreadable: a 403 forbids, no answer or a 5xx is unreachable. */
const unreadableOf = (error: HttpError): "forbidden" | "unreachable" | null =>
  error.kind === "forbidden" ? "forbidden" : error.kind === "network" || error.kind === "server" ? "unreachable" : null;

/**
 * Whether the fleet's credential counts as refused after this poll, and why: a
 * 401 at once, a source unreadable for `UNREADABLE_POLLS` polls in a row. A
 * poll that asked no adapter to read leaves the count of unreadable polls as
 * it was.
 */
const refusalOf = (fleet: StoredFleet, reading: Reading): { readonly cause: { readonly prefix: string; readonly why: RefusedWhy } | null; readonly unreadablePolls: number } => {
  const unreadablePolls = reading.unreadable !== null ? fleet.unreadablePolls + 1 : reading.attempted ? 0 : fleet.unreadablePolls;
  if (reading.refusedPrefix !== null) return { cause: { prefix: reading.refusedPrefix, why: "refused" }, unreadablePolls };
  if (reading.unreadable !== null && unreadablePolls >= UNREADABLE_POLLS) return { cause: reading.unreadable, unreadablePolls };
  return { cause: null, unreadablePolls };
};

/**
 * Polls one fleet. A failure of a service is recorded and leaves its cursor
 * where it was; only a failure of the store propagates.
 */
export async function pollFleet(deps: PollDeps, repo: string, options: PollOptions = {}): Promise<PollResult> {
  const fleet = deps.store.getFleet(repo);
  if (fleet === null) return NOTHING;
  const registration = fleet.registration;
  const now = deps.clock.now().toISOString();
  const stateOnly = options.stateOnly === true;
  const hasManager = (await deps.threads.state(registration.managerThreadId)) === "live";

  const watching = await assessWatching(deps, registration);
  const reading = await readSources(deps, fleet, watching, now, options);
  const notWatched = [...reading.notWatched];

  const { cause, unreadablePolls } = refusalOf(fleet, reading);
  const refused = cause === null ? null : { since: fleet.refused?.since ?? now, prefix: cause.prefix, why: cause.why };
  if (refused !== null) notWatched.push(credentialRefused(refused.prefix, refused.why));

  const cursors = reading.reads.map((read) => ({ role: read.role, cursor: read.derived.nextCursor }));
  const pollState = (heldSince: string | null) => ({
    lastPolledAt: now,
    notWatched,
    unreadableRows: watching.unreadableRows,
    outsideLinks: watching.watched.outside,
    expiries: reading.expiries,
    heldSince,
    unreadablePolls,
    refused: refused === null ? undefined : { ...refused, announced: fleet.refused?.announced ?? false },
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

  const announce = refused !== null && !(fleet.refused?.announced ?? false);
  if (changes.length === 0 && !announce) {
    if (cursors.length > 0) deps.store.commit({ repo, at: now, cursors });
    deps.store.savePollState(repo, pollState(null));
    return { polled: true, woke: 0, echoes, outOfScope, held, delivery: "none" };
  }

  const interval = effectiveInterval(registration);
  const catchUpMs = catchUp(fleet.lastPolledAt, now, interval);
  const earliest = reading.reads.map((read) => read.since).sort()[0] ?? registration.registeredAt;
  const since = heldFrom !== null && heldNow.length > 0 && heldFrom < earliest ? heldFrom : earliest;
  const notWatchedLine = announce && refused !== null ? { since: refused.since, prefix: refused.prefix, why: refused.why } : null;

  const delivery = await deliver(deps, fleet, { changes, since, catchUpMs, heldSince: heldNow.length > 0 ? heldFrom : null, notWatched: notWatchedLine, now });
  if (delivery.result === "refused") {
    // The same changes are offered again at the next poll: no cursor moves.
    deps.store.savePollState(repo, pollState(fleet.heldSince));
    return { polled: true, woke: 0, echoes, outOfScope, held, delivery: "refused" };
  }
  const keys = changes.map((change) => change.key);
  for (const change of changes) deps.store.recordChange(repo, rowOf(change, { kind: "wake" }, now));
  if (keys.length > 0) deps.store.markWoke(repo, delivery.wakeId, keys);
  if (cursors.length > 0) deps.store.commit({ repo, at: now, cursors });
  deps.store.savePollState(repo, pollState(null));
  if (notWatchedLine !== null) deps.store.markRefusedAnnounced(repo);
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
    const text = formatWake({ since: open.since, changes: merged, catchUpMs: open.catchUpMs, heldSince, notWatched });
    const amended = await deps.channel.amend(thread, open.queuedMessageId, text);
    if (amended === "amended") {
      deps.store.updateWake(repo, open.id, { kind: merged.length > 0 ? "changes" : "not-watched", heldSince, notWatched });
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
