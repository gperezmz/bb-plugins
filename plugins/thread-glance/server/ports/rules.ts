// What the ports snapshot holds and who it serves: the ownership rule, the
// snapshot built from machines' replies, and the auto-settle hold-back. Pure.
import type { HostListener, PortListener, PortsSnapshot } from "../../shared/ports";
import type { EnvironmentLocation } from "./environments";

/** What the last scan of a machine found. */
export type HostStatus = "ok" | "unsupported" | "failed";

/** The ports snapshot and what the server knows besides it, which no window sees. */
export interface PortsView {
  snapshot: PortsSnapshot;
  /** Machine and path of the environment of each non-archived thread that has a path. */
  locations: ReadonlyMap<string, EnvironmentLocation>;
  /** How the last read of each machine ended. A machine missing here has not been read. */
  hostStatus: ReadonlyMap<string, HostStatus>;
  /** False when the threads or environments could not be read, so nothing is known of any machine. */
  complete: boolean;
}

/**
 * The owner a host reported, if it counts: that thread is not archived and
 * works in this very environment. `threadEnvironments` holds the non-archived
 * threads.
 */
export function ownerInEnvironment(
  ownerThreadId: string | null,
  environmentId: string,
  threadEnvironments: ReadonlyMap<string, string | null>,
): string | null {
  return ownerThreadId !== null && threadEnvironments.get(ownerThreadId) === environmentId ? ownerThreadId : null;
}

const byPortThenPid = (a: PortListener, b: PortListener) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0) || a.address.localeCompare(b.address);

/**
 * The snapshot's environments: for each environment on a machine that
 * answered, the listeners in its path, with ownership applied. Several
 * environments on one path all get that path's listeners. An environment with
 * none is absent.
 */
export function snapshotEnvironments(input: {
  locations: ReadonlyMap<string, EnvironmentLocation>;
  /** The listeners each machine that answered reported. */
  scans: ReadonlyMap<string, readonly HostListener[]>;
  threadEnvironments: ReadonlyMap<string, string | null>;
}): PortsSnapshot["environments"] {
  const environments: PortsSnapshot["environments"] = {};
  for (const [environmentId, { hostId, path }] of input.locations) {
    const scanned = input.scans.get(hostId);
    if (scanned === undefined) continue;
    const listeners = scanned
      .filter((listener) => listener.workspace === path)
      .map(
        (listener): PortListener => ({
          port: listener.port,
          address: listener.address,
          process: listener.process,
          pid: listener.pid,
          startedAt: listener.startedAt,
          ownerThreadId: ownerInEnvironment(listener.ownerThreadId, environmentId, input.threadEnvironments),
          container: listener.container,
        }),
      )
      .sort(byPortThenPid);
    if (listeners.length > 0) environments[environmentId] = { hostId, listeners };
  }
  return environments;
}

/** A string that is equal for two snapshots exactly when they show the same thing; `at` is not part of it. */
export function snapshotKey(snapshot: PortsSnapshot): string {
  const ids = Object.keys(snapshot.environments).sort();
  return JSON.stringify([ids.map((id) => [id, snapshot.environments[id]]), [...snapshot.failedHosts].sort()]);
}

/** The port a thread listed by `target` owns in the environment, or undefined. */
export function ownedListener(
  snapshot: PortsSnapshot,
  environmentId: string,
  threadId: string,
  target: { port: number; pid: number; startedAt: number },
): PortListener | undefined {
  return snapshot.environments[environmentId]?.listeners.find(
    (listener) =>
      listener.ownerThreadId === threadId &&
      listener.port === target.port &&
      listener.pid === target.pid &&
      listener.startedAt === target.startedAt,
  );
}

/** The listener of the environment with that port, PID and start time, whoever owns it. */
export function listedListener(
  snapshot: PortsSnapshot,
  environmentId: string,
  target: { port: number; pid: number; startedAt: number },
): PortListener | undefined {
  return snapshot.environments[environmentId]?.listeners.find(
    (listener) => listener.port === target.port && listener.pid === target.pid && listener.startedAt === target.startedAt,
  );
}

/** The ports a thread owns that can be signalled: they have a process and a start time. */
export function ownedPortTargets(
  snapshot: PortsSnapshot,
  environmentId: string,
  threadId: string,
): { port: number; pid: number; startedAt: number; process: string | null }[] {
  const targets: { port: number; pid: number; startedAt: number; process: string | null }[] = [];
  for (const listener of snapshot.environments[environmentId]?.listeners ?? []) {
    if (listener.ownerThreadId === threadId && listener.pid !== null && listener.startedAt !== null) {
      targets.push({ port: listener.port, pid: listener.pid, startedAt: listener.startedAt, process: listener.process });
    }
  }
  return targets;
}

/** Whether the machine of the environment answered the last read, or has nothing to scan (Windows). */
export function isScannable(view: PortsView, environmentId: string): boolean {
  if (!view.complete) return false;
  const location = view.locations.get(environmentId);
  if (location === undefined) return true;
  const status = view.hostStatus.get(location.hostId);
  return status === "ok" || status === "unsupported";
}

/** A thread as the hold-back reads it. */
export interface HoldBackThread {
  id: string;
  environmentId: string | null;
}

/**
 * The threads auto-settle leaves alone for a pass: those that serve a port
 * (own one, or have an unowned one in an environment where they are the only
 * non-archived thread), and every thread whose machine could not be scanned.
 * `threads` are the non-archived threads, hidden ones included.
 */
export function holdBackThreads(threads: readonly HoldBackThread[], view: PortsView): Set<string> {
  const alone = new Map<string, number>();
  for (const thread of threads) {
    if (thread.environmentId !== null) alone.set(thread.environmentId, (alone.get(thread.environmentId) ?? 0) + 1);
  }
  const held = new Set<string>();
  for (const thread of threads) {
    const environmentId = thread.environmentId;
    if (environmentId === null) continue;
    if (!isScannable(view, environmentId)) {
      held.add(thread.id);
      continue;
    }
    const listeners = view.snapshot.environments[environmentId]?.listeners ?? [];
    const onlyThread = alone.get(environmentId) === 1;
    if (listeners.some((listener) => listener.ownerThreadId === thread.id || (listener.ownerThreadId === null && onlyThread))) {
      held.add(thread.id);
    }
  }
  return held;
}
