// What `bb unattendish fleet status` reports for each fleet.
import { formatRepo, formatTracker, repoId } from "../domain/identity";
import type { NotWatched, OutsideLink, UnreadableRow } from "../domain/model";
import { effectiveInterval } from "../domain/registration";
import { canWrite, type CredentialKind } from "../domain/accounts";
import { isExpired } from "../domain/dashboard";
import type { AccountStore, Clock, Credentials, ManifestFiles, Store, ThreadDirectory } from "./ports";
import { expiriesOf } from "./fleet-views";
import { accessRolesOf, assessWatching, refusedNotWatched, refusedSince } from "./watching";

export interface FleetStatus {
  readonly repo: string;
  readonly tracker: string;
  readonly manager: string;
  readonly managerState: "live" | "archived" | "gone";
  readonly manifest: string;
  readonly lastPolledAt: string | null;
  readonly intervalMs: number;
  /** The account each half reads as, or what it needs. */
  readonly accounts: readonly {
    readonly role: "forge" | "tracker";
    /** `GitHub · yuser`; null where no account reads the half. */
    readonly account: string | null;
    /** What the half needs; null while it reads. */
    readonly needs: string | null;
  }[];
  readonly credentials: readonly {
    readonly role: "forge" | "tracker";
    /** `GitHub · yuser for acme`. */
    readonly credential: string;
    readonly account: string;
    readonly service: string;
    readonly kind: CredentialKind;
    readonly auth: "token" | "gh" | "glab";
    readonly expiresAt: string | null;
    /** True once that expiry has passed. */
    readonly expired: boolean;
    /** True for a classic token, or a gh or glab login. */
    readonly canWrite: boolean;
    /** True for a gh or glab login, which the fleet's agents act through too. */
    readonly sharesAgentRateLimit: boolean;
  }[];
  readonly requestsThisHour: number;
  readonly watched: boolean;
  /** Set for a left-behind fleet: the repository its manifest names, whose rows and items are none of this fleet's. */
  readonly leftBehind: { readonly names: string } | null;
  readonly notWatched: readonly NotWatched[];
  /** Set while a source's credential is refused: the earliest time the fleet stopped being watched. */
  readonly notWatchedSince: string | null;
  readonly unreadableRows: readonly UnreadableRow[];
  /** References and links the manifest names that lie outside the fleet and are never fetched. */
  readonly outside: readonly OutsideLink[];
  readonly heldSince: string | null;
}

export interface StatusDeps {
  readonly store: Store;
  readonly threads: ThreadDirectory;
  readonly credentials: Credentials;
  readonly accounts: AccountStore;
  readonly manifests: ManifestFiles;
  readonly clock: Clock;
}

export async function fleetStatus(deps: StatusDeps): Promise<FleetStatus[]> {
  const hourAgo = new Date(deps.clock.now().getTime() - 3_600_000).toISOString();
  const out: FleetStatus[] = [];
  for (const fleet of deps.store.listFleets()) {
    const registration = fleet.registration;
    const repo = repoId(registration.repo);
    const watching = await assessWatching(deps, registration, repo);
    const expiries = expiriesOf(deps);
    const accounts = watching.halves.map((half) => ({
      role: half.role,
      account: half.lookup.found ? half.lookup.credential.accountLabel : (half.lookup.account?.label ?? null),
      needs: half.lookup.found ? half.unavailable : half.lookup.need,
    }));
    const credentials = watching.halves.flatMap((half) => {
      if (!half.lookup.found) return [];
      const credential = half.lookup.credential;
      return [
        {
          role: half.role,
          credential: credential.label,
          account: credential.accountLabel,
          service: credential.service,
          kind: credential.kind,
          auth: credential.auth,
          expiresAt: expiries.get(credential.key) ?? null,
          expired: isExpired(expiries.get(credential.key) ?? null, deps.clock.now()),
          canWrite: canWrite(credential.kind),
          sharesAgentRateLimit: credential.auth !== "token",
        },
      ];
    });
    const notWatched = [...watching.notWatched, ...refusedNotWatched(fleet.outages, accessRolesOf(watching))];
    out.push({
      repo: formatRepo(registration.repo),
      tracker: formatTracker(registration.tracker),
      manager: registration.managerThreadId,
      managerState: await deps.threads.state(registration.managerThreadId),
      manifest: registration.manifestPath,
      lastPolledAt: fleet.lastPolledAt,
      intervalMs: effectiveInterval(registration),
      accounts,
      credentials,
      requestsThisHour: deps.store.requestsSince(repo, hourAgo),
      watched: notWatched.length === 0,
      leftBehind: watching.manifest.status === "left-behind" ? { names: watching.manifest.names } : null,
      notWatched,
      notWatchedSince: refusedSince(fleet.outages),
      unreadableRows: watching.unreadableRows,
      outside: watching.watched.outside,
      heldSince: fleet.heldSince,
    });
  }
  return out;
}
