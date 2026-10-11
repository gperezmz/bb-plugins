// Where an environment's files are: its machine and path, which the host
// entry needs to find the processes working there. `EnvironmentSource` is the
// port; the SDK adapter is the only code here that names `bb.sdk`, and
// `cachedEnvironments` keeps what it read for a minute.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface EnvironmentLocation {
  hostId: string;
  path: string;
}

/** What was read for some environments: their locations, and the ids bb could not answer for. */
export interface EnvironmentRead {
  /** The location of each environment bb answered for; null for one with no path. */
  found: Map<string, EnvironmentLocation | null>;
  /** The environments bb failed to answer for, which say nothing about their paths. */
  failed: Set<string>;
}

export interface EnvironmentSource {
  /** Reads the environments of `ids`. Rejects when bb cannot answer for any of them. */
  read(ids: readonly string[]): Promise<EnvironmentRead>;
}

export interface ResolvedEnvironments {
  /** The locations of the environments that have one. */
  locations: Map<string, EnvironmentLocation>;
  /** The environments that could not be resolved: unlike one with no path, their workspace is unknown. */
  failed: Set<string>;
}

export interface EnvironmentDirectory {
  resolve(ids: readonly string[]): Promise<ResolvedEnvironments>;
}

/** How long a location is kept, and how many. */
export const ENVIRONMENT_TTL_MS = 60_000;
export const MAX_CACHED_ENVIRONMENTS = 5_000;
/** More missing environments than this are read with a listing, not one by one. */
const LISTING_THRESHOLD = 16;
const GET_CONCURRENCY = 8;
const LIST_PAGE_SIZE = 500;
/** The most environments asked for one by one in a read. */
const MAX_GETS = 500;
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

  async function getEach(ids: readonly string[], found: Map<string, EnvironmentLocation | null>, failed: Set<string>): Promise<void> {
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        try {
          found.set(id, locationOf(await environments.get({ environmentId: id })));
        } catch {
          failed.add(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(GET_CONCURRENCY, queue.length) }, worker));
  }

  return {
    async read(ids) {
      const found = new Map<string, EnvironmentLocation | null>();
      const failed = new Set<string>();
      if (ids.length > LISTING_THRESHOLD) await listAll(new Set(ids), found);
      const missing = ids.filter((id) => !found.has(id));
      // Whatever a listing did not show is asked for one by one, up to a bound; the rest stays unresolved.
      await getEach(missing.slice(0, MAX_GETS), found, failed);
      for (const id of missing.slice(MAX_GETS)) failed.add(id);
      if (failed.size === ids.length && ids.length > 0) throw new Error("bb could not answer for any environment");
      return { found, failed };
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
      const failed = new Set<string>();
      if (stale.length > 0) {
        const read = await source.read(stale);
        for (const [id, location] of read.found) remember(id, location, at);
        for (const id of read.failed) failed.add(id);
      }
      const locations = new Map<string, EnvironmentLocation>();
      for (const id of unique) {
        const kept = cache.get(id);
        if (kept?.location != null && at - kept.at < ENVIRONMENT_TTL_MS && !failed.has(id)) locations.set(id, kept.location);
      }
      return { locations, failed };
    },
  };
}
