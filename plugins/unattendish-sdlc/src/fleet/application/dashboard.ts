// What the Fleets dashboard asks of the plugin: the Fleets page, the Fleet chip
// and tab, the ledger, the actions sent to a manager, and the settings section.
// Every method answers from the store, the manifests and bb as they are now.
import { actionId, heldBy, latestOn, planAction } from "../domain/actions";
import { doneWith, droppedReason, groupDropped, oldestFirst, repoFromRemote, sameRepo } from "../domain/dashboard";
import { formatRepo, parseRepo, repoId } from "../domain/identity";
import { newestFirst } from "../domain/order";
import { messageOf } from "../domain/redact";
import { clip } from "../domain/text";
import { effectiveInterval, validateInterval } from "../domain/registration";
import { uniqueRowIds } from "../domain/inbox";
import { cardOf, credentialsOf, gather, inboxOf, landedViews, MAX_ROWS, manifestViewOf, recentActionsOf, watchedOf, type ViewDeps } from "./fleet-views";
import type { CredentialAdmin, DashboardEvents, ManagerChannel, ThreadRepositories, LedgerEntry } from "./ports";
import { setFleetInterval } from "./schedule";
import type { SerialQueue } from "./serial";
import type {
  ActionRecordView,
  DashboardApi,
  DroppedGroupView,
  FleetsView,
  LedgerChangeView,
  LedgerFilter,
  LedgerView,
  SettingsView,
} from "./views";

export interface DashboardDeps extends ViewDeps {
  readonly channel: ManagerChannel;
  readonly events: DashboardEvents;
  readonly repositories: ThreadRepositories;
  readonly admin: CredentialAdmin;
  readonly queue: SerialQueue;
  readonly log: { warn(message: string): void };
  /** Every token the plugin holds, to scrub from anything said of a failure. */
  readonly secrets: () => string[];
}

/**
 * Most entries `fleet ledger` prints, and most changes a ledger answer lists. bb refuses a command that prints more
 * than 1 MiB, so the widest row, once every field is bounded to `FIELD_MAX`, times this must stay under it;
 * `cli.test.ts` checks it with the widest rows there can be, in the text and in the JSON.
 */
export const LEDGER_LIMIT = 250;
/** Most wakes a ledger answer lists. */
const WAKES_SHOWN = 50;
/** How many changes the ledger counts for its dropped groups, and how many of each group it lists. */
const DROPPED_COUNTED = 1000;
const DROPPED_LISTED = 25;
/** A string in a ledger answer, or printed by `fleet ledger`, is cut to this many characters. */
export const FIELD_MAX = 200;

const refused = (reason: string) => ({ ok: false as const, reason });
const unknownFleet = (repo: string) => refused(`no fleet is registered for ${clip(repo, 80)}`);

export function createDashboard(deps: DashboardDeps): DashboardApi {
  const keyOf = (repo: string): string | null => {
    const parsed = parseRepo(repo);
    return parsed === null ? null : repoId(parsed);
  };
  /** Rows an action is being sent on, so two sends together do not both pass the check. */
  const sending = new Set<string>();

  const fleets = async (): Promise<FleetsView> => {
    const now = deps.clock.now();
    const gathered = await Promise.all(deps.store.listFleets().map((fleet) => gather(deps, fleet, false)));
    const parts = gathered.map((g) => ({ g, inbox: inboxOf(g) }));
    const cards = await Promise.all(parts.map(({ g }) => cardOf(deps, g, now)));
    return {
      generatedAt: now.toISOString(),
      waiting: cards.reduce((total, card) => total + card.waiting, 0),
      fleets: cards,
      inbox: oldestFirst(parts.flatMap(({ inbox }) => inbox.rows)).slice(0, MAX_ROWS * 2),
      unreadableInbox: parts.flatMap(({ inbox }) => inbox.unreadable).slice(0, MAX_ROWS * 2),
      recentActions: parts.flatMap(({ g, inbox }) => recentActionsOf(g, inbox.ids, now)).sort(newestFirst((action) => action.doneAt!))
        .slice(0, MAX_ROWS),
      landed: parts
        .flatMap(({ g }) => landedViews(g, now))
        .sort((a, b) => Date.parse(b.merged) - Date.parse(a.merged))
        .slice(0, MAX_ROWS * 2),
    };
  };

  const threadFleet: DashboardApi["threadFleet"] = async ({ threadId }) => {
    const now = deps.clock.now();
    const stored = deps.store.listFleets();
    const own = stored.find((fleet) => fleet.registration.managerThreadId === threadId);
    if (own !== undefined) return { kind: "manager", card: await cardOf(deps, await gather(deps, own, false), now) };
    const remote = await deps.repositories.remoteOf(threadId).catch(() => null);
    const repo = remote === null ? null : repoFromRemote(remote);
    const holder = repo === null ? undefined : stored.find((fleet) => sameRepo(fleet.registration.repo, repo));
    return { kind: "none", holder: holder === undefined ? null : { repo: formatRepo(holder.registration.repo), managerThreadId: holder.registration.managerThreadId } };
  };

  const fleetDetail: DashboardApi["fleetDetail"] = async ({ repo }) => {
    const key = keyOf(repo);
    const fleet = key === null ? null : deps.store.getFleet(key);
    if (key === null || fleet === null) return unknownFleet(repo);
    const now = deps.clock.now();
    const g = await gather(deps, fleet, true);
    const inbox = inboxOf(g);
    return {
      ok: true,
      detail: {
        generatedAt: now.toISOString(),
        card: await cardOf(deps, g, now),
        manifest: manifestViewOf(g, inbox, now),
        watched: watchedOf(deps, g),
        credentials: credentialsOf(g),
        requestsThisHour: deps.store.requestsSince(key, new Date(now.getTime() - 3_600_000).toISOString()),
        recentActions: recentActionsOf(g, inbox.ids, now),
      },
    };
  };

  // ---- the ledger ----

  const changeView = (entry: LedgerEntry): LedgerChangeView | null => {
    if (entry.type === "change") {
      const row = entry.row;
      return { at: row.seenAt, ref: clip(row.ref, FIELD_MAX), url: clip(row.url, FIELD_MAX), kind: clip(row.label === null ? row.kind : `${row.kind} ${row.label}`, FIELD_MAX), actor: row.actor === null ? null : clip(row.actor, FIELD_MAX), done: doneWith(row.disposition), rule: row.rule === null ? null : clip(row.rule, FIELD_MAX) };
    }
    if (entry.type === "failed read") {
      return { at: entry.at, ref: entry.ref === null ? "" : clip(entry.ref, FIELD_MAX), url: "", kind: `failed read of the ${entry.role}`, actor: null, done: "failed read", rule: clip(entry.reason, FIELD_MAX) };
    }
    return null;
  };

  const ledger: DashboardApi["ledger"] = async ({ repo, filter }) => {
    const key = keyOf(repo);
    if (key === null || deps.store.getFleet(key) === null) return unknownFleet(repo);
    const wanted: LedgerFilter = filter ?? {};
    const limit = Math.max(1, Math.min(LEDGER_LIMIT, Math.trunc(wanted.limit ?? LEDGER_LIMIT)));
    const item = wanted.item?.trim() === "" ? undefined : wanted.item?.trim();
    const withItem = item === undefined ? {} : { item };
    // One query for each thing done: a mix of them would let the polls crowd out the changes. Under All the list holds the
    // changes that were not dropped, cut to the limit among themselves: the dropped ones are listed, grouped by reason, in
    // `dropped` from queries of their own, so that however many are newer they cannot push every woken change off.
    const dones = wanted.done === undefined ? (["woke", "held", "failed read"] as const) : ([wanted.done] as const);
    const changes = dones
      .flatMap((done) => deps.store.ledger(key, { ...withItem, done, limit }))
      .flatMap((entry) => changeView(entry) ?? [])
      .sort(newestFirst((change) => change.at))
      .slice(0, limit);

    const dropsAsked = wanted.done === undefined || wanted.done === "echo" || wanted.done === "out-of-scope" ? (["echo", "out-of-scope"] as const) : [];
    const dropped = dropsAsked
      .flatMap((done) => deps.store.ledger(key, { ...withItem, done, limit: DROPPED_COUNTED }))
      .flatMap((entry) => {
        if (entry.type !== "change") return [];
        const reason = droppedReason(entry.row);
        const view = changeView(entry);
        return reason === null || view === null ? [] : [{ reason, view }];
      })
      .sort(newestFirst((drop) => drop.view.at));
    const groups: DroppedGroupView[] = groupDropped(dropped).map((group) => ({ reason: group.reason, count: group.count, changes: group.changes.slice(0, DROPPED_LISTED).map((change) => change.view) }));

    const view: LedgerView = {
      generatedAt: deps.clock.now().toISOString(),
      changes,
      dropped: groups,
      wakes: deps.store.recentWakes(key, WAKES_SHOWN).map((wake) => ({ queuedAt: wake.queuedAt, dispatchedAt: wake.dispatchedAt, kind: wake.kind })),
    };
    return { ok: true, ledger: view };
  };

  // ---- actions ----

  const sendAction: DashboardApi["sendAction"] = async (input) => {
    const key = keyOf(input.fleet);
    const fleet = key === null ? null : deps.store.getFleet(key);
    if (key === null || fleet === null) return unknownFleet(input.fleet);
    // Taken before anything is awaited, so two sends together cannot both pass the check below.
    const lock = `${key}\u0000${input.rowId}`;
    if (sending.has(lock)) return refused("an action is already sent on this row");
    sending.add(lock);
    try {
      const registration = fleet.registration;
      const manifest = await deps.manifests.read(registration.manifestPath);
      const read = manifest.status === "ok" ? manifest.manifest.inbox : [];
      const at = uniqueRowIds(read).indexOf(input.rowId);
      const taken = latestOn(heldBy(deps.store.actions(key), registration.managerThreadId), input.rowId) !== null;
      const plan = planAction({ row: at === -1 ? undefined : read[at], kind: input.kind, text: input.text, regrant: input.regrant, managerThreadId: registration.managerThreadId, taken });
      if (!plan.ok) return refused(plan.reason);

      const delivery = await deps.channel.send(registration.managerThreadId, plan.message);
      // bb's own reason, already bounded and scrubbed of the text sent by the channel; a token is scrubbed again here.
      if (delivery.delivered === "refused") return refused(messageOf(delivery.reason, deps.secrets()));
      // The send took time: a take-over meanwhile means the message went to a manager that no longer holds the fleet.
      if (deps.store.getFleet(key)?.registration.managerThreadId !== registration.managerThreadId) return refused("the fleet changed manager while the message was sent, so the new manager did not get it; send it again");
      const row = read[at]!;
      const sentAt = deps.clock.now().toISOString();
      const record = { id: actionId(input.rowId, sentAt), repo: key, rowId: input.rowId, kind: input.kind, ref: row.ref, what: row.what, managerThreadId: registration.managerThreadId, state: "sent" as const, sentAt, doneAt: null };
      deps.store.saveAction(record);
      deps.events.boardChanged();
      const action: ActionRecordView = { id: record.id, fleet: formatRepo(registration.repo), kind: record.kind, ref: record.ref, what: record.what, state: "sent", sentAt, doneAt: null };
      return { ok: true, action };
    } finally {
      sending.delete(lock);
    }
  };

  // ---- settings ----

  const settingsView = async (overlay?: { readonly repo: string; readonly intervalMs: number | null }): Promise<SettingsView> => {
    const { entries, problems } = await deps.admin.list();
    const stored = deps.store.listFleets();
    return {
      credentials: entries.map((entry) => ({
        prefix: entry.prefix,
        auth: entry.auth,
        service: entry.service,
        baseUrl: entry.baseUrl,
        hasToken: entry.hasToken,
        expiresAt: stored.map((fleet) => fleet.expiries[entry.prefix] ?? null).filter((at): at is string => at !== null).sort()[0] ?? null,
        problem: entry.problem,
      })),
      fleets: stored.map((fleet) => {
        const registration = overlay !== undefined && overlay.repo === repoId(fleet.registration.repo) ? { ...fleet.registration, intervalMs: overlay.intervalMs } : fleet.registration;
        return { repo: formatRepo(registration.repo), intervalMs: effectiveInterval(registration), isDefault: registration.intervalMs === null };
      }),
      problems: [...problems],
    };
  };

  const edited = async (result: { readonly ok: true } | { readonly ok: false; readonly reason: string }) => {
    if (!result.ok) return refused(result.reason);
    deps.events.boardChanged();
    return { ok: true as const, settings: await settingsView() };
  };

  const setInterval: DashboardApi["setInterval"] = async ({ repo, seconds }) => {
    const key = keyOf(repo);
    if (key === null || deps.store.getFleet(key) === null) return unknownFleet(repo);
    const ms = seconds === null ? null : seconds * 1000;
    if (ms !== null) {
      const valid = validateInterval(ms);
      if (!valid.ok) return refused(valid.reason);
    }
    // Like the command line's `fleet interval`: behind any poll of the fleet, which a page does not wait for.
    const waits = !deps.queue.busy(key);
    const work = deps.queue.run(key, async () => setFleetInterval(deps, key, ms)).then(
      () => deps.events.boardChanged(),
      (error: unknown) => deps.log.warn(`setting the interval of ${key} failed: ${messageOf(error, deps.secrets())}`),
    );
    if (waits) await work;
    return { ok: true, settings: await settingsView(waits ? undefined : { repo: key, intervalMs: ms }) };
  };

  return {
    fleets,
    threadFleet,
    fleetDetail,
    ledger,
    sendAction,
    settings: () => settingsView(),
    saveCredential: async (draft) => edited(await deps.admin.save(draft)),
    removeCredential: async ({ prefix }) => edited(await deps.admin.remove(prefix)),
    setInterval,
  };
}
