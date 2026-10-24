// Clean: close the live terminals and the owned ports of the threads on the
// Settled shelf. A preview lists what would close and is kept for two minutes;
// running it checks every thread and workspace again before each terminal and
// each port, closes terminals whether or not anyone typed into them, and sends
// SIGTERM to ports by port, PID and start time. No thread leaves Settled.
//
// Clean's rule (every running terminal) is not Reclaim's (only terminals nobody
// typed into); the two share nothing. The module names no SDK.
import { randomUUID } from "node:crypto";
import { inBatches } from "../../shared/batches";
import { liftedIds } from "../../shared/lifecycle";
import type { PreviewCleanOutput, RunCleanOutput } from "../../shared/ports";
import type { LifecycleStore } from "../lifecycle-store";
import { isLiveTerminal, type ThreadRuntime } from "../runtime";
import type { ServerThread, ThreadGateway } from "../threads";
import type { PortsEngine } from "./engine";
import type { PortsHost } from "./host";
import { isCleanable, omitSharedWorkspaces } from "./clean-rules";
import { distinctProcesses, isScannable, ownedListener, ownedPortTargets } from "./rules";
import {
  MAX_PREVIEW_THREADS,
  MAX_THREAD_PORTS,
  MAX_THREAD_TERMINALS,
  PREVIEW_TTL_MS,
  type PreviewStore,
  type StoredPreviewThread,
} from "./preview-store";

/** How long Clean waits after the last request before it reads the ports again. */
export const SETTLE_WAIT_MS = 750;
const READ_CONCURRENCY = 6;

export interface Clean {
  preview(projectId: string | null): Promise<PreviewCleanOutput>;
  run(token: string): Promise<RunCleanOutput>;
}

export interface CleanDeps {
  threads: Pick<ThreadGateway, "snapshot">;
  lifecycle: Pick<LifecycleStore, "get">;
  runtime: ThreadRuntime;
  engine: PortsEngine;
  host: PortsHost;
  previews: PreviewStore;
  now?: () => number;
  newToken?: () => string;
  /** Resolves after `ms`; replaced in tests. */
  wait?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
}

const EXPIRED: RunCleanOutput = { expired: true, closedTerminals: 0, portRequests: 0, stillListening: [], issues: [] };

export function createClean(deps: CleanDeps): Clean {
  const { lifecycle, runtime, engine, host, previews } = deps;
  const now = deps.now ?? Date.now;
  const newToken = deps.newToken ?? randomUUID;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const warn = deps.warn ?? (() => undefined);

  /** The threads that pass Clean's test and share no workspace with one that fails it, from the threads bb has now. */
  async function eligibleThreads(): Promise<{ eligible: ServerThread[] }> {
    const all = await deps.threads.snapshot();
    const at = now();
    const lifted = liftedIds(all.filter((thread) => !thread.hidden));
    const failing = new Set(all.filter((thread) => !isCleanable(thread, lifecycle.get(thread.id), at, lifted.has(thread.id))).map((thread) => thread.id));
    const candidates = all.filter((thread) => !failing.has(thread.id));
    const environmentIds = [...new Set(all.flatMap((thread) => (thread.environmentId === null ? [] : [thread.environmentId])))];
    const { locations } = await engine.locate(environmentIds);
    return { eligible: omitSharedWorkspaces({ candidates, allThreads: all, failing, locations }) };
  }

  async function terminalIdsOf(thread: ServerThread): Promise<string[]> {
    try {
      return (await runtime.terminals(thread.id)).filter(isLiveTerminal).map((terminal) => terminal.id);
    } catch {
      warn(`clean: could not list the terminals of ${thread.id}`);
      return [];
    }
  }

  return {
    async preview(projectId) {
      const { eligible } = await eligibleThreads();
      const inScope = eligible.filter((thread) => projectId === null || thread.projectId === projectId);
      const view = inScope.length > 0 ? await engine.read({ fresh: true }) : engine.current();

      const terminalIds = await inBatches(inScope, READ_CONCURRENCY, terminalIdsOf);
      const found: StoredPreviewThread[] = [];
      inScope.forEach((thread, index) => {
        const environmentId = thread.environmentId;
        if (environmentId === null) return;
        const ports = isScannable(view, environmentId) ? ownedPortTargets(view.snapshot, environmentId, thread.id).slice(0, MAX_THREAD_PORTS) : [];
        const terminals = terminalIds[index].slice(0, MAX_THREAD_TERMINALS);
        if (terminals.length === 0 && ports.length === 0) return;
        found.push({ threadId: thread.id, title: thread.title, environmentId, terminalIds: terminals, ports });
      });
      const threads = found.slice(0, MAX_PREVIEW_THREADS);
      const token = newToken();
      const at = now();
      previews.put(token, { threads }, at);
      return {
        token,
        expiresAt: at + PREVIEW_TTL_MS,
        threads: threads.map((thread) => ({
          threadId: thread.threadId,
          title: thread.title,
          terminals: thread.terminalIds.length,
          ports: thread.ports.map(({ port, process }) => ({ port, process })),
        })),
      };
    },

    async run(token) {
      const preview = previews.take(token, now());
      if (preview === null) return EXPIRED;

      let closedTerminals = 0;
      let portRequests = 0;
      const requested = new Map<number, { environmentId: string; pid: number; startedAt: number }>();
      const issues: string[] = [];

      /** Whether the thread, and every thread sharing its workspace, still passes, in its environment. */
      async function stillClean(thread: StoredPreviewThread): Promise<boolean> {
        const { eligible } = await eligibleThreads();
        return eligible.some((candidate) => candidate.id === thread.threadId && candidate.environmentId === thread.environmentId);
      }

      const skipped = (thread: StoredPreviewThread) =>
        issues.push(`${thread.title}: skipped, it is no longer settled or its workspace is shared`);

      threads: for (const thread of preview.threads) {
        try {
          for (const terminalId of thread.terminalIds) {
            if (!(await stillClean(thread))) {
              skipped(thread);
              continue threads;
            }
            const current = await runtime.terminal(terminalId);
            if (current === undefined || !isLiveTerminal(current)) continue;
            if (await runtime.closeForce(terminalId)) closedTerminals += 1;
            else issues.push(`${thread.title}: a terminal could not be closed`);
          }

          if (thread.ports.length === 0) continue;
          const view = await engine.read({ fresh: true });
          if (!isScannable(view, thread.environmentId)) {
            issues.push(`${thread.title}: its ports could not be checked`);
            continue;
          }
          const location = view.locations.get(thread.environmentId);
          if (location === undefined) {
            issues.push(`${thread.title}: its workspace could not be found`);
            continue;
          }
          // A process serving two ports is signalled once, and both ports are then expected to close.
          for (const target of distinctProcesses(thread.ports)) {
            if (ownedListener(view.snapshot, thread.environmentId, thread.threadId, target) === undefined) continue;
            if (!(await stillClean(thread))) {
              skipped(thread);
              continue threads;
            }
            const result = await host.signal(location.hostId, {
              port: target.port,
              pid: target.pid,
              startedAt: target.startedAt,
              workspaces: [location.path],
            });
            if (result === "sent") {
              portRequests += 1;
              for (const served of thread.ports) {
                if (served.pid === target.pid && served.startedAt === target.startedAt) {
                  requested.set(served.port, { environmentId: thread.environmentId, pid: target.pid, startedAt: target.startedAt });
                }
              }
            } else if (result === "failed") {
              issues.push(`${thread.title}: port ${target.port} could not be stopped`);
            }
          }
        } catch {
          issues.push(`${thread.title}: could not be cleaned`);
        }
      }

      const stillListening: number[] = [];
      if (requested.size > 0) {
        await wait(SETTLE_WAIT_MS);
        const view = await engine.refresh();
        for (const [port, { environmentId, pid, startedAt }] of requested) {
          const listeners = view.snapshot.environments[environmentId]?.listeners ?? [];
          if (listeners.some((listener) => listener.port === port && listener.pid === pid && listener.startedAt === startedAt)) {
            stillListening.push(port);
          }
        }
        stillListening.sort((a, b) => a - b);
      }
      return { expired: false, closedTerminals, portRequests, stillListening, issues };
    },
  };
}
