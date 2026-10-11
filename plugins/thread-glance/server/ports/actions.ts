// Stop, and the settle prompt's lookup and Close. Each signals only a process
// the current snapshot lists for the thread's environment (and, for Close,
// owned by the thread), and the host then checks port, PID and start time
// again before it sends SIGTERM. The module names no SDK: bb is reached through
// `ThreadGateway` and the host through `PortsHost`.
import type { PortTarget } from "../../shared/ports";
import { staleMark, type LifecycleRow } from "../../shared/lifecycle";
import type { LifecycleStore } from "../lifecycle-store";
import type { ThreadGateway, ThreadPresence } from "../threads";
import type { PortsEngine } from "./engine";
import type { PortsHost } from "./host";
import { distinctProcesses, isScannable, listedListener, ownedListener, ownedPortTargets, type PortsView } from "./rules";

export interface PortActions {
  /** Stop on one listener of the thread's environment. Rejects when the host cannot be asked. */
  stop(input: { threadId: string } & PortTarget): Promise<{ outcome: "requested" | "refused" | "gone" }>;
  /** The ports the thread owns now, from a fresh read. Rejects when the lookup fails. */
  owned(threadId: string): Promise<{ ports: (PortTarget & { process: string | null })[] }>;
  /** Close on the settle prompt. Rejects when the lookup or a call fails. */
  close(input: { threadId: string; ports: readonly PortTarget[] }): Promise<{ outcome: "requested" | "partial" | "none" }>;
}

export interface PortActionDeps {
  threads: Pick<ThreadGateway, "snapshot" | "find">;
  lifecycle: Pick<LifecycleStore, "get">;
  engine: PortsEngine;
  host: PortsHost;
}

/** Whether the thread is still on the Settled shelf by its row: a settle that attention has not made stale. */
export function isStillSettled(row: LifecycleRow | null, thread: Pick<ThreadPresence, "latestAttentionAt">): boolean {
  return row !== null && row.settledAt !== null && staleMark(row, thread) === null;
}

export function createPortActions(deps: PortActionDeps): PortActions {
  const { threads, lifecycle, engine, host } = deps;

  /**
   * The thread's environment and its place on its machine, or null for a
   * thread bb no longer lists or one without a path. Rejects when bb cannot
   * say where the environment is.
   */
  async function placeOf(threadId: string, view: PortsView): Promise<{ environmentId: string; hostId: string; path: string } | null> {
    const thread = (await threads.snapshot()).find((candidate) => candidate.id === threadId);
    if (thread === undefined || thread.environmentId === null) return null;
    const environmentId = thread.environmentId;
    if (view.unresolved.has(environmentId)) throw new Error("Ports could not be checked");
    let location = view.locations.get(environmentId);
    if (location === undefined) {
      const resolved = await engine.locate([environmentId]);
      if (resolved.failed.has(environmentId)) throw new Error("Ports could not be checked");
      location = resolved.locations.get(environmentId);
    }
    return location === undefined ? null : { environmentId, ...location };
  }

  async function stillSettled(threadId: string): Promise<boolean> {
    const thread = await threads.find(threadId);
    return thread !== undefined && !thread.archived && isStillSettled(lifecycle.get(threadId), thread);
  }

  return {
    async stop({ threadId, port, pid, startedAt }) {
      const view = await engine.read({ fresh: false });
      const place = await placeOf(threadId, view);
      if (place === null || listedListener(view.snapshot, place.environmentId, { port, pid, startedAt }) === undefined) {
        return { outcome: "refused" };
      }
      const result = await host.signal(place.hostId, { port, pid, startedAt, workspaces: [place.path] });
      await engine.refresh();
      if (result === "failed") throw new Error("The process could not be stopped");
      return { outcome: result === "sent" ? "requested" : "gone" };
    },

    async owned(threadId) {
      const view = await engine.read({ fresh: true });
      const place = await placeOf(threadId, view);
      if (place === null) return { ports: [] };
      if (!isScannable(view, place.environmentId)) throw new Error("Ports could not be checked");
      return { ports: ownedPortTargets(view.snapshot, place.environmentId, threadId) };
    },

    async close({ threadId, ports }) {
      if (!(await stillSettled(threadId))) return { outcome: "none" };
      const view = await engine.read({ fresh: true });
      const place = await placeOf(threadId, view);
      if (place === null) return { outcome: "none" };
      if (!isScannable(view, place.environmentId)) throw new Error("Ports could not be checked");
      // A process serving two ports gets one signal.
      const matching = distinctProcesses(ports.filter((target) => ownedListener(view.snapshot, place.environmentId, threadId, target) !== undefined));
      if (matching.length === 0) return { outcome: "none" };

      let sent = 0;
      let failed = 0;
      for (const target of matching) {
        // The thread may have been un-settled while an earlier process shut down.
        if (!(await stillSettled(threadId))) {
          continue;
        }
        const result = await host.signal(place.hostId, { port: target.port, pid: target.pid, startedAt: target.startedAt, workspaces: [place.path] });
        if (result === "sent") sent += 1;
        else if (result === "failed") failed += 1;
      }
      await engine.refresh();
      if (sent === 0 && failed === 0) return { outcome: "none" };
      return { outcome: sent === matching.length ? "requested" : "partial" };
    },
  };
}
