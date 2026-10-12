// A fleet as the dashboard shows it: what is gathered of it once, and the card,
// the Inbox rows, the manifest and the watched set built from that.
import type { ActionRecord } from "../domain/actions";
import { latestOn, recentActions as recentOf } from "../domain/actions";
import { credentialWarnings, landedToday, landedWithin, listWatched, oldestFirst, reasonsOf, unreadableInbox } from "../domain/dashboard";
import { formatRepo, formatTracker, repoId } from "../domain/identity";
import { offerFor, parseLink, uniqueRowIds } from "../domain/inbox";
import type { InboxRow, WrittenSection } from "../domain/model";
import { effectiveInterval } from "../domain/registration";
import { clip } from "../domain/text";
import { watchedWithReasons } from "../domain/watched";
import type { Clock, Credentials, CostReader, ManifestFiles, Store, ThreadDirectory, ThreadStanding } from "./ports";
import { refusedNotWatched, assessWatching, type Watching } from "./watching";
import type { ActionRecordView, BlockedRowView, FleetCardView, FleetCredentialView, InboxRowView, InFlightRowView, LandedRowView, ManifestView, ManagerView, UnreadableInboxRowView, WatchedItemView } from "./views";
import { identityOf } from "./observe";

/** Most rows of one list a view carries, and most characters of one cell: a page lists what fits, and the counts still say how many there are. */
export const MAX_ROWS = 200;
const CELL = 500;

export interface ViewDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly credentials: Credentials;
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
  readonly standing: ThreadStanding;
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
    assessWatching({ credentials: deps.credentials, manifests }, registration),
    deps.threads.standing(registration.managerThreadId).catch((): ThreadStanding => ({ state: "gone" })),
  ]);
  return { fleet, repo, name: formatRepo(registration.repo), watching, written, records: deps.store.actions(repo), standing };
}

// ---- the Inbox ----

const actionView = (g: Gathered, record: ActionRecord): ActionRecordView => ({ id: record.id, fleet: g.name, kind: record.kind, ref: record.ref, what: clip(record.what, CELL), state: record.state, sentAt: record.sentAt, doneAt: record.doneAt });

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
      what: clip(row.what, CELL),
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

// ---- the card ----

const credentialsOf = (g: Gathered): FleetCredentialView[] =>
  [g.watching.forge, g.watching.tracker]
    .filter((resolved) => resolved !== null)
    .map((resolved) => ({
      role: resolved.source.role,
      prefix: resolved.credential.prefix,
      auth: resolved.credential.auth,
      expiresAt: g.fleet.expiries[resolved.credential.prefix] ?? null,
      sharesAgentRateLimit: resolved.credential.auth !== "token",
    }));

export const credentialViews = credentialsOf;

const managerOf = (standing: ThreadStanding): ManagerView => (standing.state === "live" ? { state: standing.busy ? "working" : "idle", since: standing.since } : { state: "none", since: null });

export const COST_PERIOD = "since this manager started";

export async function cardOf(deps: ViewDeps, g: Gathered, now: Date): Promise<FleetCardView> {
  const registration = g.fleet.registration;
  const manifest = g.watching.manifest;
  const unreadable = manifest.status === "ok" ? manifest.manifest.unreadable : [];
  const cost = await deps.cost.costOf(registration.managerThreadId).catch(() => null);
  return {
    repo: g.name,
    tracker: formatTracker(registration.tracker),
    managerThreadId: registration.managerThreadId,
    manager: managerOf(g.standing),
    waiting: manifest.status === "ok" ? manifest.manifest.inbox.length + unreadableInbox(unreadable).length : 0,
    inFlight: manifest.status === "ok" ? manifest.manifest.inFlight.length : 0,
    landedToday: manifest.status === "ok" ? landedToday(manifest.manifest.landed, now) : 0,
    cost: cost === null ? null : { amount: cost.amount, currency: cost.currency, period: COST_PERIOD },
    lastPolledAt: g.fleet.lastPolledAt,
    intervalMs: effectiveInterval(registration),
    reasons: reasonsOf([...g.watching.notWatched, ...refusedNotWatched(g.fleet.outages)], unreadable).map((reason) => ({ code: reason.code, text: reason.text, fix: { kind: reason.fix } })),
    warnings: credentialWarnings(credentialsOf(g), now),
  };
}

// ---- the Fleet tab ----

export const landedViews = (g: Gathered, now: Date): LandedRowView[] =>
  g.watching.manifest.status !== "ok"
    ? []
    : landedWithin(g.watching.manifest.manifest.landed, now, 7).slice(0, MAX_ROWS).map((row) => ({ fleet: g.name, ref: row.ref, spec: clip(row.spec, CELL), merged: row.merged, link: parseLink(row.link) }));

export function manifestViewOf(g: Gathered, inbox: InboxViews, now: Date): ManifestView {
  const manifest = g.watching.manifest;
  if (manifest.status === "missing") return { status: "missing" };
  if (manifest.status === "unreadable") return { status: "unreadable", reason: manifest.reason };
  const read = manifest.manifest;
  return {
    status: "ok",
    inbox: inbox.rows,
    unreadableInbox: inbox.unreadable,
    inFlight: read.inFlight.slice(0, MAX_ROWS).map((row): InFlightRowView => ({ ref: row.ref, work: clip(row.work, CELL), stage: row.stage, since: row.since, builderThreadId: row.builder === "—" ? null : row.builder, link: parseLink(row.link) })),
    blocked: read.blocked.slice(0, MAX_ROWS).map((row): BlockedRowView => ({ ref: row.ref, blockedOn: row.blockedOn, link: parseLink(row.link) })),
    landed: landedViews(g, now),
    unreadable: read.unreadable.slice(0, MAX_ROWS).map((row) => ({ section: row.section, line: row.line, reason: row.reason })),
    written: g.written.map((section) => ({ heading: section.heading, markdown: section.markdown })),
  };
}

export function watchedOf(deps: Pick<ViewDeps, "store">, g: Gathered): WatchedItemView[] {
  const registration = g.fleet.registration;
  const manifest = g.watching.manifest;
  const forge = g.watching.forge?.source;
  const named = manifest.status === "ok" ? watchedWithReasons(manifest.manifest, identityOf(registration, forge?.role === "forge" ? forge.service : "github")) : [];
  const cursors = (["forge", "tracker"] as const).map((role) => ({ role, cursor: deps.store.getCursor(g.repo, role) }));
  return listWatched(named, cursors, registration.labels).slice(0, MAX_ROWS * 2).map((item) => ({ ref: item.ref, url: item.url, why: item.why }));
}
