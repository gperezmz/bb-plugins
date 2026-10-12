// Registering a fleet: a manager thread says which repository it runs, and
// what the plugin should treat as the fleet's own.
import { repoId } from "../domain/identity";
import type { ManifestRead, NotWatched, Registration } from "../domain/model";
import { decideHolder, validateRegistration, type RegisterArgs } from "../domain/registration";
import { uniqueRowIds } from "../domain/inbox";
import type { AccountStore, Clock, Credentials, DashboardEvents, ManifestFiles, ServiceProbe, Store, ThreadDirectory } from "./ports";
import { forgeHalf, trackerHalf } from "../domain/accounts";
import { announceNeeds } from "./needs";
import { accessRolesOf, assessWatching, lookupOf, refusedNotWatched, type Watching } from "./watching";

export type RegisterOutcome =
  | { readonly outcome: "registered"; readonly watched: boolean; readonly notWatched: readonly NotWatched[] }
  | { readonly outcome: "taken-over"; readonly previousManager: string; readonly previousManifest: string; readonly watched: boolean; readonly notWatched: readonly NotWatched[] }
  | { readonly outcome: "refused"; readonly holder: string }
  | { readonly outcome: "unsupported"; readonly supported: readonly number[] }
  | { readonly outcome: "invalid"; readonly reason: string };

export interface RegisterDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly credentials: Credentials;
  readonly accounts: AccountStore;
  readonly probe: ServiceProbe;
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
  readonly events: DashboardEvents;
}

/**
 * Registers `thread` as the manager of the repository in `args`. A refusal,
 * an unsupported contract version or an invalid argument changes nothing.
 */
export async function registerFleet(deps: RegisterDeps, thread: string, args: RegisterArgs): Promise<RegisterOutcome> {
  const validated = validateRegistration(args);
  if (validated.outcome === "unsupported") return { outcome: "unsupported", supported: validated.supported };
  if (validated.outcome === "invalid") return { outcome: "invalid", reason: validated.reason };

  const key = repoId(validated.fields.repo);
  const existing = deps.store.getFleet(key);
  const holder = existing === null || existing.registration.managerThreadId === thread ? null : await deps.threads.state(existing.registration.managerThreadId);
  const decision = decideHolder(existing === null ? null : { managerThreadId: existing.registration.managerThreadId }, thread, holder);
  if (decision.action === "refuse") return { outcome: "refused", holder: decision.holder };

  const registration: Registration = {
    ...validated.fields,
    managerThreadId: thread,
    intervalMs: existing?.registration.intervalMs ?? null,
    registeredAt: existing?.registration.registeredAt ?? deps.clock.now().toISOString(),
  };
  const watching = await assessWatching(deps, registration, key);
  const notWatched = [...watching.notWatched, ...refusedNotWatched(existing?.outages ?? {}, accessRolesOf(watching))];
  deps.store.saveRegistration(registration, notWatched);
  // A half the fleet needs an account for is said once, as the fleet comes to need it.
  announceNeeds(deps.events, registration, existing?.notWatched ?? [], notWatched);
  baselineInbox(deps, key, watching.manifest, deps.clock.now().toISOString());
  // A manager that takes over never got the messages sent to the one before it.
  if (decision.action === "take-over") deps.store.dropSentActions(key);
  deps.events.boardChanged();

  const watched = notWatched.length === 0;
  if (decision.action === "take-over" && existing !== null) {
    return { outcome: "taken-over", previousManager: decision.previousManager, previousManifest: existing.registration.manifestPath, watched, notWatched };
  }
  return { outcome: "registered", watched, notWatched };
}

/**
 * Right after a fleet registers: asks the service whether each half's credential can read the half's repository, team
 * or project, and records what it cannot, as Connect does, so the fleet is not watched from then on rather than after
 * polls; a half whose credential can read it loses an old record. A service that does not answer changes nothing: the
 * polls read it. It runs apart from the registration, which a slow service would otherwise hold up.
 */
export async function checkFleetAccess(deps: RegisterDeps, repo: string): Promise<void> {
  const fleet = deps.store.getFleet(repo);
  if (fleet === null) return;
  const registration = fleet.registration;
  const watching = await assessWatching(deps, registration, repo);
  if (!(await checkAccess(deps, repo, registration, watching))) return;
  const after = await assessWatching(deps, registration, repo);
  announceNeeds(deps.events, registration, watching.notWatched, after.notWatched);
  deps.events.boardChanged();
}

const checkAccess = async (deps: RegisterDeps, repo: string, registration: Registration, watching: Watching): Promise<boolean> => {
  let changed = false;
  const now = deps.clock.now().toISOString();
  for (const half of watching.halves) {
    if (!half.lookup.found || half.unavailable !== null) continue;
    const credential = half.lookup.credential;
    const target = half.role === "forge" ? forgeHalf(registration.repo, credential.service) : trackerHalf(registration.tracker);
    const token = target === null ? null : await deps.credentials.token(credential).catch(() => null);
    if (target === null || token === null) continue;
    const readable = await deps.probe.canRead({ service: credential.service, baseUrl: credential.baseUrl, host: credential.host }, token, target);
    if (readable === "unreachable") continue;
    // The answer is written only for the registration and the credential it was asked for: while the service answered,
    // the fleet may have been unregistered or registered again, or Connect may have given the half another credential.
    const held = deps.store.getFleet(repo);
    if (held === null || held.registration.registeredAt !== registration.registeredAt || held.registration.managerThreadId !== registration.managerThreadId) return changed;
    const current = lookupOf(deps.credentials, held.registration, half.role);
    if (!current.found || current.credential.key !== credential.key) continue;
    const why = readable === "readable" ? null : readable;
    if (why === (half.access?.why ?? null)) continue;
    deps.accounts.setAccessProblem(repo, half.role, why === null ? null : { credentialId: credential.key, why, at: now });
    changed = true;
  }
  return changed;
};

/**
 * The registration's first look at the Inbox: the rows of a manifest that is there are recorded without a signal, and
 * a manifest that is not there yet baselines the empty Inbox, so the first rows the manager writes are new. A manifest
 * that exists but cannot be read baselines nothing: the first read that can is the baseline.
 */
const baselineInbox = (deps: RegisterDeps, repo: string, manifest: ManifestRead, at: string): void => {
  if (manifest.status === "ok") deps.store.touchInboxSeen(repo, uniqueRowIds(manifest.manifest.inbox), at);
  if (manifest.status !== "unreadable") deps.store.setInboxBaselined(repo);
};
