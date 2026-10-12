// What `bb unattendish fleet status` reports for each fleet.
import { formatRepo, repoId } from "../domain/identity";
import type { NotWatched, UnreadableRow } from "../domain/model";
import { effectiveInterval } from "../domain/registration";
import type { Clock, Credentials, Store, ThreadDirectory } from "./ports";
import { assessWatching } from "./watching";
import type { ManifestFiles } from "./ports";

export interface FleetStatus {
  readonly repo: string;
  readonly tracker: string;
  readonly manager: string;
  readonly managerState: "live" | "archived" | "gone";
  readonly manifest: string;
  readonly lastPolledAt: string | null;
  readonly intervalMs: number;
  readonly credentials: readonly {
    readonly role: "forge" | "tracker";
    readonly prefix: string;
    readonly service: string;
    readonly auth: "token" | "gh" | "glab";
    readonly expiresAt: string | null;
    /** True for a gh or glab login, which the fleet's agents act through too. */
    readonly sharesAgentRateLimit: boolean;
  }[];
  readonly requestsThisHour: number;
  readonly watched: boolean;
  readonly notWatched: readonly NotWatched[];
  /** Set while a credential is refused: when the fleet stopped being watched. */
  readonly notWatchedSince: string | null;
  readonly unreadableRows: readonly UnreadableRow[];
  /** References and links the manifest names that lie outside the fleet and are never fetched. */
  readonly outside: readonly { readonly text: string; readonly section: string; readonly line: number }[];
  readonly heldSince: string | null;
}

export interface StatusDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly credentials: Credentials;
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
}

const trackerText = (tracker: { kind: string; team?: string; site?: string; project?: string }): string =>
  tracker.kind === "linear" ? `linear:${tracker.team}` : tracker.kind === "jira" ? `jira:${tracker.site}/${tracker.project}` : "forge-issues";

export async function fleetStatus(deps: StatusDeps): Promise<FleetStatus[]> {
  const hourAgo = new Date(deps.clock.now().getTime() - 3_600_000).toISOString();
  const out: FleetStatus[] = [];
  for (const fleet of deps.store.listFleets()) {
    const registration = fleet.registration;
    const watching = await assessWatching(deps, registration);
    const credentials = [watching.forge, watching.tracker]
      .filter((resolved) => resolved !== null)
      .map((resolved) => ({
        role: resolved.source.role,
        prefix: resolved.credential.prefix,
        service: resolved.credential.service,
        auth: resolved.credential.auth,
        expiresAt: fleet.expiries[resolved.credential.prefix] ?? null,
        sharesAgentRateLimit: resolved.credential.auth !== "token",
      }));
    const notWatched = fleet.refused === null ? watching.notWatched : [...watching.notWatched, { code: "credential-refused" as const, text: `The credential for ${fleet.refused.prefix} was refused by the service` }];
    out.push({
      repo: formatRepo(registration.repo),
      tracker: trackerText(registration.tracker),
      manager: registration.managerThreadId,
      managerState: await deps.threads.state(registration.managerThreadId),
      manifest: registration.manifestPath,
      lastPolledAt: fleet.lastPolledAt,
      intervalMs: effectiveInterval(registration),
      credentials,
      requestsThisHour: deps.store.requestsSince(repoId(registration.repo), hourAgo),
      watched: notWatched.length === 0,
      notWatched,
      notWatchedSince: fleet.refused?.since ?? null,
      unreadableRows: watching.unreadableRows,
      outside: watching.watched.outside,
      heldSince: fleet.heldSince,
    });
  }
  return out;
}
