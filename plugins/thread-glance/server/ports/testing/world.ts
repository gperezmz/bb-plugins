// A ports service over fakes: threads, rows, terminals, machines and a clock,
// built the way `server.ts` builds the real one.
import { settledRow, type LifecycleRow } from "../../../shared/lifecycle";
import { createLifecycleStore } from "../../lifecycle-store";
import { createFakeRuntime, createFakeThreads, makeServerThread, memoryDatabase } from "../../testing/fakes";
import type { RuntimeTerminal } from "../../runtime";
import type { ServerThread } from "../../threads";
import { createPortActions } from "../actions";
import { createClean } from "../clean";
import { createPortsEngine } from "../engine";
import type { EnvironmentLocation } from "../environments";
import { createPreviewStore } from "../preview-store";
import { createClock, createFakeEnvironments, createFakePortsHost, hostListener } from "./fakes";
import type { HostListener, PortsSnapshot } from "../../../shared/ports";

/** When a settled thread settled; later than the default latest attention of a thread. */
export const SETTLED_AT = 900_000;

export const settled = (id: string, environmentId: string | null, overrides: Partial<ServerThread> = {}): ServerThread =>
  makeServerThread(id, { environmentId, ...overrides });

export interface WorldOptions {
  threads?: ServerThread[];
  rows?: Record<string, LifecycleRow>;
  locations?: Record<string, EnvironmentLocation>;
  machines?: Record<string, HostListener[] | Error>;
  terminals?: Record<string, RuntimeTerminal[]>;
}

export function createPortsWorld(options: WorldOptions = {}) {
  const clock = createClock();
  const db = memoryDatabase();
  const lifecycle = createLifecycleStore(db);
  lifecycle.putMany(Object.entries(options.rows ?? {}));
  const threads = createFakeThreads(options.threads ?? []);
  const runtime = createFakeRuntime(options.terminals);
  const host = createFakePortsHost(options.machines);
  const environments = createFakeEnvironments(options.locations);
  const published: PortsSnapshot[] = [];
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const engine = createPortsEngine({ threads, environments, host, publish: (snapshot) => published.push(snapshot), now: clock.read, warn });
  const actions = createPortActions({ threads, lifecycle, engine, host });
  const previews = createPreviewStore(db);
  const waits: number[] = [];
  const clean = createClean({
    threads,
    lifecycle,
    runtime,
    engine,
    host,
    previews,
    now: clock.read,
    newToken: (() => {
      let next = 0;
      return () => `token-${(next += 1)}`;
    })(),
    wait: async (ms) => {
      waits.push(ms);
    },
    warn,
  });
  /** A new Clean over the same database, as after a restart. */
  const restartedClean = () =>
    createClean({ threads, lifecycle, runtime, engine, host, previews: createPreviewStore(db), now: clock.read, wait: async () => undefined });
  return { clock, db, lifecycle, threads, runtime, host, environments, engine, actions, clean, restartedClean, published, warnings, waits };
}

export type PortsWorld = ReturnType<typeof createPortsWorld>;

export { hostListener, settledRow };
