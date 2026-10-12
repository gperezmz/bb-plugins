// Registering a fleet: a manager thread says which repository it runs, and
// what the plugin should treat as the fleet's own.
import { repoId } from "../domain/identity";
import type { NotWatched, Registration } from "../domain/model";
import { decideHolder, validateRegistration, type RegisterArgs } from "../domain/registration";
import type { Clock, Credentials, ManifestFiles, Store, ThreadDirectory } from "./ports";
import { assessWatching, refusedNotWatched } from "./watching";

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
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
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
  const watching = await assessWatching(deps, registration);
  const notWatched = [...watching.notWatched, ...refusedNotWatched(existing?.outages ?? {})];
  deps.store.saveRegistration(registration, notWatched);

  const watched = notWatched.length === 0;
  if (decision.action === "take-over" && existing !== null) {
    return { outcome: "taken-over", previousManager: decision.previousManager, previousManifest: existing.registration.manifestPath, watched, notWatched };
  }
  return { outcome: "registered", watched, notWatched };
}
