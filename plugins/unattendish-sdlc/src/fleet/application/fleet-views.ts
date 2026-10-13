// A fleet as the dashboard shows it: what is gathered of it once, and the card,
// the Inbox rows, the manifest and the watched set built from that.
import type { ActionRecord } from "../domain/actions";
import { heldBy, latestOn, recentActions as recentOf } from "../domain/actions";
import { credentialWarnings, expiredProblems, isExpired, LANDED_DAYS, landedWithin, listWatched, oldestFirst, pollingWarning, problemsOf, refusalsUnexplained, unreadableInbox } from "../domain/dashboard";
import { formatRepo, formatTracker, repoId } from "../domain/identity";
import { offerFor, parseLink, uniqueRowIds } from "../domain/inbox";
import type { InboxRow, WrittenSection } from "../domain/model";
import { effectiveInterval } from "../domain/registration";
import { CELL_MAX_CHARS, clip } from "../domain/text";
import { watchedWithReasons } from "../domain/watched";
import { accessProblemText, canWrite, halfWhat } from "../domain/accounts";
import { credentialRefused } from "../domain/registration";
import type { AccountStore, Clock, Credentials, CostReader, ManifestFiles, Store, ThreadDirectory, ThreadStanding } from "./ports";
import { accessRolesOf, assessWatching, fixedByConnect, forgeServiceOf, refusedNotWatched, type Watching } from "./watching";
import type { ActionRecordView, BlockedRowView, FleetCardView, FleetCredentialView, HalfView, InboxRowView, InFlightRowView, LandedRowView, ManifestView, ManagerView, NeedsAccountView, UnreadableInboxRowView, WatchedItemView } from "./views";
import { identityOf } from "./observe";

/** Most rows of one list a view carries, and most characters of one cell: a page lists what fits, and the counts still say how many there are. */
export const MAX_ROWS = 200;

export interface ViewDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly credentials: Credentials;
  readonly accounts: AccountStore;
  readonly manifests: ManifestFiles;
  readonly cost: CostReader;
  readonly clock: Clock;
}

type StoredFleetOf = ReturnType<Store["listFleets"]>[number];

/** What is read of one fleet for a view: its poll state, its manifest and what it makes of its credentials, the actions kept, and its manager's standing. */
export interface Gathered {
  readonly fleet: StoredFleetOf;
  /** The id the store keys the fleet by. */
  readonly repo: string;
  /** The repository as the manifest spells it. */
  readonly name: string;
  readonly watching: Watching;
  readonly written: readonly WrittenSection[];
  readonly records: readonly ActionRecord[];
  /** Null where bb did not answer for the thread, which says nothing of whether it is gone. */
  readonly standing: ThreadStanding | null;
}

export async function gather(deps: ViewDeps, fleet: StoredFleetOf, withSections: boolean): Promise<Gathered> {
  const registration = fleet.registration;
  let manifests = deps.manifests;
  let written: readonly WrittenSection[] = [];
  if (withSections) {
    const sections = await deps.manifests.readSections(registration.manifestPath);
    written = sections.written;
    manifests = { read: async () => sections.read, readSections: async () => sections };
  }
  const repo = repoId(registration.repo);
  const [watching, standing] = await Promise.all([
    assessWatching({ credentials: deps.credentials, accounts: deps.accounts, manifests }, registration, repo),
    deps.threads.standing(registration.managerThreadId).catch((): ThreadStanding | null => null),
  ]);
  return { fleet, repo, name: formatRepo(registration.repo), watching, written, records: heldBy(deps.store.actions(repo), registration.managerThreadId), standing };
}

// ---- the Inbox ----

const actionView = (g: Gathered, record: ActionRecord): ActionRecordView => ({ id: record.id, fleet: g.name, kind: record.kind, ref: record.ref, what: clip(record.what, CELL_MAX_CHARS), state: record.state, sentAt: record.sentAt, doneAt: record.doneAt });

export interface InboxViews {
  readonly rows: readonly InboxRowView[];
  readonly unreadable: readonly UnreadableInboxRowView[];
  readonly ids: ReadonlySet<string>;
}

/** The fleet's Inbox as the page lists it: each readable row with its action or what it offers, and the rows that cannot be read. */
export function inboxOf(g: Gathered): InboxViews {
  const manifest = g.watching.manifest;
  if (manifest.status !== "ok") return { rows: [], unreadable: [], ids: new Set() };
  const manager = g.fleet.registration.managerThreadId;
  const ids = uniqueRowIds(manifest.manifest.inbox);
  const rows = manifest.manifest.inbox.map((row: InboxRow, at): InboxRowView => {
    const id = ids[at]!;
    const record = latestOn(g.records, id);
    return {
      id,
      fleet: g.name,
      managerThreadId: manager,
      ref: row.ref,
      what: clip(row.what, CELL_MAX_CHARS),
      waitsFor: row.waitsFor,
      since: row.since,
      link: parseLink(row.link),
      offer: record === null ? offerFor(row, manager) : null,
      action: record === null ? null : actionView(g, record),
    };
  });
  const unreadable = unreadableInbox(manifest.manifest.unreadable).map((row): UnreadableInboxRowView => ({ fleet: g.name, managerThreadId: manager, line: row.line, reason: row.reason }));
  return { rows: oldestFirst(rows).slice(0, MAX_ROWS), unreadable: unreadable.slice(0, MAX_ROWS), ids: new Set(ids) };
}

/** Actions done in the last hour whose row has left the Inbox, newest first. */
export const recentActionsOf = (g: Gathered, ids: ReadonlySet<string>, now: Date): ActionRecordView[] => recentOf(g.records, ids, now).slice(0, MAX_ROWS).map((record) => actionView(g, record));

/** The fleet header's last action: the newest of `recentActionsOf`, or null with none. */
export const lastActionOf = (g: Gathered, ids: ReadonlySet<string>, now: Date): ActionRecordView | null => recentActionsOf(g, ids, now)[0] ?? null;

// ---- the card ----

/** The expiry the service last reported for each credential, by its id. */
export const expiriesOf = (deps: Pick<ViewDeps, "accounts">): Map<string, string | null> => new Map(deps.accounts.credentials().map((credential) => [credential.id, credential.expiresAt]));

export const credentialsOf = (deps: Pick<ViewDeps, "accounts">, g: Gathered, now: Date): FleetCredentialView[] => {
  const expiries = expiriesOf(deps);
  return g.watching.halves.flatMap((half) => {
    if (!half.lookup.found) return [];
    const credential = half.lookup.credential;
    return [
      {
        role: half.role,
        label: credential.label,
        account: { id: credential.accountId, label: credential.accountLabel },
        kind: credential.kind,
        auth: credential.auth,
        expiresAt: expiries.get(credential.key) ?? null,
        expired: isExpired(expiries.get(credential.key) ?? null, now),
        canWrite: canWrite(credential.kind),
        sharesAgentRateLimit: credential.auth !== "token",
      },
    ];
  });
};

/** The credentials the fleet reads with, as `expiredProblems` and `credentialWarnings` weigh them. */
const warnedOf = (deps: Pick<ViewDeps, "accounts">, g: Gathered) => {
  const expiries = expiriesOf(deps);
  return g.watching.halves.flatMap((half) => {
    if (!half.lookup.found) return [];
    const credential = half.lookup.credential;
    return [{ role: half.role, label: credential.label, credentialId: credential.key, accountId: credential.accountId, auth: credential.auth, expiresAt: expiries.get(credential.key) ?? null }];
  });
};

/**
 * Each half: the account it reads as, and what it needs, first of: no account or credential, no token, a credential
 * that cannot read it, a credential the service refuses. A service that does not answer needs nothing of the operator.
 */
export const halvesOf = (g: Gathered): HalfView[] =>
  g.watching.halves.map((half): HalfView => {
    const registration = g.fleet.registration;
    const what = halfWhat(registration.repo, registration.tracker, half.role);
    if (!half.lookup.found) return { role: half.role, what, account: half.lookup.account, credential: null, canWrite: false, needs: half.lookup.need };
    const credential = half.lookup.credential;
    const refused = g.fleet.outages[half.role]?.refused ?? null;
    const needs =
      half.unavailable ??
      (half.access !== null ? accessProblemText(credential, what) : null) ??
      (refused !== null && refused.credential === credential.label && fixedByConnect(refused.why) ? credentialRefused(refused.credential, refused.why).text : null);
    return { role: half.role, what, account: { id: credential.accountId, label: credential.accountLabel }, credential: credential.label, canWrite: canWrite(credential.kind), needs };
  });

/** The halves that need an account or a credential that reads them. */
export const needsAccountOf = (g: Gathered): NeedsAccountView[] =>
  halvesOf(g).flatMap((half) => (half.needs === null ? [] : [{ fleet: g.name, managerThreadId: g.fleet.registration.managerThreadId, role: half.role, text: half.needs }]));

/** The manager as the card shows it; one bb did not answer for shows as none, without the problem a gone manager raises. */
const managerOf = (standing: ThreadStanding | null): ManagerView => (standing?.state === "live" ? { state: standing.busy ? "working" : "idle", since: standing.since } : { state: "none", since: null });

export const COST_PERIOD = "since this manager started";

/** The other fleets the fleet's manager thread holds, by name, whose spend is the same money. */
const sharingOf = (deps: Pick<ViewDeps, "store">, g: Gathered): string[] =>
  deps.store
    .listFleets()
    .filter((other) => other.registration.managerThreadId === g.fleet.registration.managerThreadId && repoId(other.registration.repo) !== g.repo)
    .map((other) => formatRepo(other.registration.repo))
    .sort();

export async function cardOf(deps: ViewDeps, g: Gathered, now: Date): Promise<FleetCardView> {
  const registration = g.fleet.registration;
  const manifest = g.watching.manifest;
  const unreadable = manifest.status === "ok" ? manifest.manifest.unreadable : [];
  const cost = await deps.cost.costOf(registration.managerThreadId).catch(() => null);
  const sharedWith = sharingOf(deps, g);
  const intervalMs = effectiveInterval(registration);
  const polling = pollingWarning(g.fleet.lastPolledAt, intervalMs, now);
  const weighed = warnedOf(deps, g);
  const expired = expiredProblems(weighed, now);
  return {
    repo: g.name,
    forge: forgeServiceOf(g.watching),
    tracker: formatTracker(registration.tracker),
    managerThreadId: registration.managerThreadId,
    manager: managerOf(g.standing),
    waiting: manifest.status === "ok" ? manifest.manifest.inbox.length + unreadableInbox(unreadable).length : 0,
    inFlight: manifest.status === "ok" ? manifest.manifest.inFlight.length : 0,
    blocked: manifest.status === "ok" ? manifest.manifest.blocked.length : 0,
    landed: manifest.status === "ok" ? landedWithin(manifest.manifest.landed, now, LANDED_DAYS).length : 0,
    cost: cost === null ? null : { amount: cost.amount, currency: cost.currency, period: COST_PERIOD, sharedWith },
    lastPolledAt: g.fleet.lastPolledAt,
    intervalMs,
    problems: problemsOf(
      refusalsUnexplained([...g.watching.notWatched, ...refusedNotWatched(g.fleet.outages, accessRolesOf(g.watching))], expired),
      unreadable,
      g.standing !== null && g.standing.state !== "live",
      manifest.status === "left-behind" ? { fleet: g.name, names: manifest.names } : null,
      expired,
    ),
    halves: halvesOf(g),
    warnings: [...credentialWarnings(weighed, now), ...(polling === null ? [] : [polling])],
  };
}

// ---- the Fleet tab ----

export const landedViews = (g: Gathered, now: Date): LandedRowView[] =>
  g.watching.manifest.status !== "ok"
    ? []
    : landedWithin(g.watching.manifest.manifest.landed, now, LANDED_DAYS).slice(0, MAX_ROWS).map((row) => ({ fleet: g.name, ref: row.ref, spec: clip(row.spec, CELL_MAX_CHARS), merged: row.merged, link: parseLink(row.link) }));

export function manifestViewOf(g: Gathered, inbox: InboxViews, now: Date): ManifestView {
  const manifest = g.watching.manifest;
  if (manifest.status === "missing") return { status: "missing" };
  if (manifest.status === "unreadable") return { status: "unreadable", reason: manifest.reason };
  if (manifest.status === "left-behind") return { status: "left-behind", names: manifest.names };
  const read = manifest.manifest;
  return {
    status: "ok",
    inbox: inbox.rows,
    unreadableInbox: inbox.unreadable,
    inFlight: read.inFlight.slice(0, MAX_ROWS).map((row): InFlightRowView => ({ ref: row.ref, work: clip(row.work, CELL_MAX_CHARS), stage: row.stage, since: row.since, builderThreadId: row.builder === "—" ? null : row.builder, link: parseLink(row.link) })),
    blocked: read.blocked.slice(0, MAX_ROWS).map((row): BlockedRowView => ({ ref: row.ref, blockedOn: row.blockedOn, link: parseLink(row.link) })),
    landed: landedViews(g, now),
    unreadable: read.unreadable.slice(0, MAX_ROWS).map((row) => ({ section: row.section, line: row.line, reason: row.reason })),
    written: g.written.map((section) => ({ heading: section.heading, markdown: section.markdown })),
  };
}

export function watchedOf(deps: Pick<ViewDeps, "store">, g: Gathered): WatchedItemView[] {
  const registration = g.fleet.registration;
  const manifest = g.watching.manifest;
  const named = manifest.status === "ok" ? watchedWithReasons(manifest.manifest, identityOf(registration, forgeServiceOf(g.watching))) : [];
  const cursors = (["forge", "tracker"] as const).map((role) => ({ role, cursor: deps.store.getCursor(g.repo, role) }));
  return listWatched(named, cursors, registration.labels).slice(0, MAX_ROWS * 2).map((item) => ({ ref: item.ref, url: item.url, why: item.why }));
}
