// Where an environment's files are: its machine and path, which the host
// entry needs to find the processes working there. `EnvironmentSource` is the
// port; the SDK adapter is the only code here that names `bb.sdk`, and
// `cachedEnvironments` keeps what it read for a minute.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface EnvironmentLocation {
  hostId: string;
  path: string;
}

export interface EnvironmentSource {
  /**
   * The location of each environment of `ids` that bb answers for: null for
   * one with no path, absent for one bb does not know. Rejects when bb cannot
   * answer for any of them.
   */
  read(ids: readonly string[]): Promise<Map<string, EnvironmentLocation | null>>;
}

export interface EnvironmentDirectory {
  /** The locations of the environments of `ids` that have one. An environment bb could not answer for is absent. */
  resolve(ids: readonly string[]): Promise<Map<string, EnvironmentLocation>>;
}

/** How long a location is kept, and how many. */
export const ENVIRONMENT_TTL_MS = 60_000;
export const MAX_CACHED_ENVIRONMENTS = 5_000;
/** More missing environments than this are read with a listing, not one by one. */
const LISTING_THRESHOLD = 16;
const GET_CONCURRENCY = 8;
const LIST_PAGE_SIZE = 500;
const MAX_LIST_PAGES = 40;

export function createSdkEnvironments(bb: Pick<BbPluginApi, "sdk">): EnvironmentSource {
  const { environments } = bb.sdk;
  const locationOf = (environment: { hostId: string; path: string | null }): EnvironmentLocation | null =>
    environment.path === null || environment.path === "" ? null : { hostId: environment.hostId, path: environment.path };

  async function listAll(wanted: ReadonlySet<string>, found: Map<string, EnvironmentLocation | null>): Promise<void> {
    for (let page = 0; page < MAX_LIST_PAGES && found.size < wanted.size; page++) {
      const listed = await environments.list({ limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE });
      for (const environment of listed) if (wanted.has(environment.id)) found.set(environment.id, locationOf(environment));
      if (listed.length < LIST_PAGE_SIZE) break;
    }
  }

  async function getEach(ids: readonly string[], found: Map<string, EnvironmentLocation | null>): Promise<void> {
    const queue = [...ids];
    let failures = 0;
    const worker = async () => {
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        try {
          found.set(id, locationOf(await environments.get({ environmentId: id })));
        } catch {
          failures += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(GET_CONCURRENCY, queue.length) }, worker));
    if (failures === ids.length && ids.length > 0) throw new Error("bb could not answer for any environment");
  }

  return {
    async read(ids) {
      const found = new Map<string, EnvironmentLocation | null>();
      if (ids.length > LISTING_THRESHOLD) await listAll(new Set(ids), found);
      const missing = ids.filter((id) => !found.has(id));
      // Whatever a listing did not show is asked for one by one, up to a bound.
      await getEach(missing.slice(0, LIST_PAGE_SIZE), found);
      return found;
    },
  };
}

/** Keeps each location for a minute, at most `MAX_CACHED_ENVIRONMENTS` of them. */
export function cachedEnvironments(source: EnvironmentSource, now: () => number = Date.now): EnvironmentDirectory {
  const cache = new Map<string, { at: number; location: EnvironmentLocation | null }>();

  function remember(id: string, location: EnvironmentLocation | null, at: number): void {
    cache.delete(id);
    cache.set(id, { at, location });
    for (const key of cache.keys()) {
      if (cache.size <= MAX_CACHED_ENVIRONMENTS) break;
      cache.delete(key);
    }
  }

  return {
    async resolve(ids) {
      const at = now();
      const unique = [...new Set(ids)];
      const stale = unique.filter((id) => {
        const kept = cache.get(id);
        return kept === undefined || at - kept.at >= ENVIRONMENT_TTL_MS;
      });
      if (stale.length > 0) {
        for (const [id, location] of await source.read(stale)) remember(id, location, at);
      }
      const resolved = new Map<string, EnvironmentLocation>();
      for (const id of unique) {
        const kept = cache.get(id);
        if (kept?.location != null && at - kept.at < ENVIRONMENT_TTL_MS) resolved.set(id, kept.location);
      }
      return resolved;
    },
  };
}
