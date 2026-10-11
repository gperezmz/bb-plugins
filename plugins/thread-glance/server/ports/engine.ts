// The ports snapshot: one scan per machine, shared by every reader, kept for
// up to 30 s, with a backoff for a machine that fails. Rows never scan; a
// window asks for the snapshot, and the engine scans only when what it holds
// is too old.
import { EMPTY_PORTS, MAX_WORKSPACES_PER_SCAN, type PortsSnapshot } from "../../shared/ports";
import type { HostListener } from "../../shared/ports";
import type { ThreadGateway } from "../threads";
import type { EnvironmentDirectory, EnvironmentLocation } from "./environments";
import type { PortsHost } from "./host";
import { snapshotEnvironments, snapshotKey, type HostStatus, type PortsView } from "./rules";

/** How old the snapshot may be for a normal read, and for a read that asks for a fresh one. */
export const SNAPSHOT_TTL_MS = 30_000;
export const FRESH_TTL_MS = 2_000;
/** A machine that fails is not asked again for 30 s, then twice as long after each failure, up to 5 minutes. */
export const BACKOFF_FIRST_MS = 30_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const BACKOFF_MAX_FAILURES = 5;
/** When every machine fails, the last snapshot stays this long; after it the indicators clear. */
export const KEEP_LAST_MS = 5 * 60_000;
const MAX_TRACKED_HOSTS = 200;
const SCAN_CONCURRENCY = 4;

export interface PortsEngine {
  /** The snapshot, scanning first when it is older than 30 s (2 s for `fresh`). Concurrent reads share one scan. Never rejects. */
  read(options: { fresh: boolean }): Promise<PortsView>;
  /** Scans now, after any scan in flight. Never rejects. */
  refresh(): Promise<PortsView>;
  /** The snapshot as it stands, without scanning. */
  current(): PortsView;
  /** The locations of environments, from the cache bb's answers fill. */
  locate(environmentIds: readonly string[]): Promise<ReadonlyMap<string, EnvironmentLocation>>;
}

export interface PortsEngineDeps {
  threads: Pick<ThreadGateway, "snapshot">;
  environments: EnvironmentDirectory;
  host: PortsHost;
  /** Called with the snapshot whenever what it shows changes. */
  publish(snapshot: PortsSnapshot): void;
  now?: () => number;
  /** Lines name machines, ports and counts, never processes, environments or command lines. */
  warn?: (message: string) => void;
}

interface Backoff {
  failures: number;
  retryAt: number;
}

/** The delay after the nth failure in a row. */
export function backoffDelay(failures: number): number {
  return Math.min(BACKOFF_FIRST_MS * 2 ** (Math.min(failures, BACKOFF_MAX_FAILURES) - 1), BACKOFF_MAX_MS);
}

export function createPortsEngine(deps: PortsEngineDeps): PortsEngine {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? (() => undefined);
  const backoffs = new Map<string, Backoff>();
  let view: PortsView = { snapshot: EMPTY_PORTS, locations: new Map(), hostStatus: new Map(), complete: false };
  let readAt = Number.NEGATIVE_INFINITY;
  let published = snapshotKey(EMPTY_PORTS);
  let inFlight: Promise<PortsView> | null = null;

  function publishIfChanged(snapshot: PortsSnapshot): void {
    const key = snapshotKey(snapshot);
    if (key === published) return;
    published = key;
    deps.publish(snapshot);
  }

  function noteFailure(hostId: string, at: number): void {
    const failures = (backoffs.get(hostId)?.failures ?? 0) + 1;
    backoffs.delete(hostId);
    backoffs.set(hostId, { failures, retryAt: at + backoffDelay(failures) });
    for (const key of backoffs.keys()) {
      if (backoffs.size <= MAX_TRACKED_HOSTS) break;
      backoffs.delete(key);
    }
    warn(`ports: scan of host ${hostId} failed (${failures} in a row); next try in ${Math.round(backoffDelay(failures) / 1_000)} s`);
  }

  async function scanHost(hostId: string, paths: readonly string[], at: number): Promise<{ status: HostStatus; listeners?: HostListener[] }> {
    const backoff = backoffs.get(hostId);
    if (backoff !== undefined && backoff.retryAt > at) return { status: "failed" };
    try {
      const reply = await deps.host.scan(hostId, paths);
      backoffs.delete(hostId);
      return reply.supported ? { status: "ok", listeners: reply.listeners } : { status: "unsupported" };
    } catch {
      noteFailure(hostId, at);
      return { status: "failed" };
    }
  }

  /** The view when nothing new was learned: the last snapshot stays unless it is too old to show. */
  function keepLast(
    at: number,
    hostStatus: ReadonlyMap<string, HostStatus>,
    complete: boolean,
    locations: ReadonlyMap<string, EnvironmentLocation> = view.locations,
  ): PortsView {
    const tooOld = at - view.snapshot.at > KEEP_LAST_MS;
    const failedHosts = [...hostStatus].filter(([, status]) => status === "failed").map(([hostId]) => hostId);
    const snapshot: PortsSnapshot = tooOld ? { at, environments: {}, failedHosts } : view.snapshot;
    if (tooOld) publishIfChanged(snapshot);
    return { snapshot, locations, hostStatus, complete };
  }

  async function cycle(): Promise<PortsView> {
    const at = now();
    readAt = at;
    let threads;
    let locations: ReadonlyMap<string, EnvironmentLocation>;
    try {
      threads = await deps.threads.snapshot();
      locations = await deps.environments.resolve([...new Set(threads.flatMap((thread) => (thread.environmentId === null ? [] : [thread.environmentId])))]);
    } catch {
      warn("ports: could not read the threads or their environments");
      return keepLast(at, new Map(), false);
    }

    const workspaces = new Map<string, Set<string>>();
    for (const { hostId, path } of locations.values()) {
      const paths = workspaces.get(hostId) ?? new Set<string>();
      paths.add(path);
      workspaces.set(hostId, paths);
    }
    const hostIds = [...workspaces.keys()];
    const replies = new Map<string, Awaited<ReturnType<typeof scanHost>>>();
    for (let start = 0; start < hostIds.length; start += SCAN_CONCURRENCY) {
      await Promise.all(
        hostIds.slice(start, start + SCAN_CONCURRENCY).map(async (hostId) => {
          replies.set(hostId, await scanHost(hostId, [...(workspaces.get(hostId) ?? [])].slice(0, MAX_WORKSPACES_PER_SCAN), at));
        }),
      );
    }

    const hostStatus = new Map([...replies].map(([hostId, reply]) => [hostId, reply.status] as const));
    const failedHosts = hostIds.filter((hostId) => hostStatus.get(hostId) === "failed").sort();
    if (hostIds.length > 0 && failedHosts.length === hostIds.length) return keepLast(at, hostStatus, true, locations);

    const scans = new Map<string, readonly HostListener[]>();
    for (const [hostId, reply] of replies) if (reply.listeners !== undefined) scans.set(hostId, reply.listeners);
    const threadEnvironments = new Map(threads.map((thread) => [thread.id, thread.environmentId] as const));
    const snapshot: PortsSnapshot = { at, environments: snapshotEnvironments({ locations, scans, threadEnvironments }), failedHosts };
    publishIfChanged(snapshot);
    return { snapshot, locations, hostStatus, complete: true };
  }

  function start(): Promise<PortsView> {
    if (inFlight !== null) return inFlight;
    const running = cycle().then((next) => (view = next));
    const release = () => {
      if (inFlight === running) inFlight = null;
    };
    running.then(release, release);
    inFlight = running;
    return running;
  }

  return {
    async read({ fresh }) {
      if (inFlight !== null) return inFlight;
      return now() - readAt <= (fresh ? FRESH_TTL_MS : SNAPSHOT_TTL_MS) ? view : start();
    },
    async refresh() {
      if (inFlight !== null) await inFlight;
      return start();
    },
    current: () => view,
    locate: (environmentIds) => deps.environments.resolve(environmentIds),
  };
}
