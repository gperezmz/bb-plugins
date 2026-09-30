// The plugin server's figures, on bb's fake plugin host: realtime signals per
// thread event, what `sync` carries, and the first `sync` after a server
// start with 5,000 stored threads, read from the plugin's own SQLite
// database: the handler alone, and the host's whole call beside it.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

export interface ServerFigures {
  /** Realtime signals one thread event publishes, by event. */
  signalsPerEvent: Record<string, number>;
  /** What `sync` carries, with every thread of a list stamped and noted and a tenth of them archived. */
  syncPayload: {
    threads: number;
    archived: number;
    /** Thread records the first `sync` carries, and how many of them are archived threads'. */
    firstRecords: number;
    firstArchivedRecords: number;
    firstBytes: number;
    /** A `sync` from the first one's revision, with nothing changed since. */
    unchangedRecords: number;
    unchangedBytes: number;
  };
  /** The first `sync` after a restart over 5,000 stored threads, in ms: the handler alone, and the host's whole call. */
  firstRead: { handlerMs: number; callMs: number; threads: number };
}

type Host = Awaited<ReturnType<typeof load>>;
type Handlers = Record<string, (input: unknown) => Promise<unknown>>;

async function load() {
  const host = createFakePluginHost({ pluginId: "thread-glance" });
  await plugin(host.bb);
  return host;
}

/** The plugin's factory, keeping the RPC handlers it registers in `handlers`. */
function capturing(handlers: Handlers) {
  return (bb: Parameters<typeof plugin>[0]) => {
    const register = bb.rpc.register.bind(bb.rpc);
    bb.rpc.register = ((contract: unknown, registered: Handlers, ...rest: unknown[]) => {
      Object.assign(handlers, registered);
      return (register as (...args: unknown[]) => unknown)(contract, registered, ...rest);
    }) as typeof bb.rpc.register;
    return plugin(bb);
  };
}

/** Every thread in `ids` runs one turn to a finish with a note. */
async function seed(harness: Host["harness"], ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const thread = makeThreadResponse({ id });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: `Finished ${id}.` });
  }
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

export async function runServer(threadIds: readonly string[]): Promise<ServerFigures> {
  const { harness } = await load();
  const thread = makeThreadResponse({ id: "t_signals" });
  const events: [string, () => Promise<unknown>][] = [
    ["thread.active", () => harness.behavior.emitThreadEvent("thread.active", { thread })],
    [
      "interaction.pending",
      () =>
        harness.behavior.emitThreadEvent("interaction.pending", {
          thread,
          interaction: { createdAt: Date.now(), payload: { kind: "user_question", questions: [{ id: "q", prompt: "Go on?" }] } } as never,
        }),
    ],
    ["thread.idle", () => harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: "Done." })],
    ["thread.failed", () => harness.behavior.emitThreadEvent("thread.failed", { thread, error: "Disk full" })],
    [
      "turn.failed",
      () =>
        harness.behavior.emitThreadEvent("turn.failed", {
          threadId: thread.id,
          turnId: "turn_1",
          errorInfo: { category: "billing", httpStatusCode: 402 },
        } as never),
    ],
  ];
  const signalsPerEvent: Record<string, number> = {};
  for (const [name, emit] of events) {
    const before = harness.inspection.realtimeSignals.length;
    await emit();
    signalsPerEvent[name] = harness.inspection.realtimeSignals.length - before;
  }

  // A fresh server, every thread stamped and noted, a tenth archived.
  const payload = await load();
  await seed(payload.harness, threadIds);
  const archived = threadIds.filter((_, index) => index % 10 === 0);
  for (const id of archived) {
    await payload.harness.behavior.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id }) });
  }
  const first = (await payload.harness.behavior.callRpc("sync", { since: null })) as {
    epoch: string;
    revision: number;
    records: Record<string, unknown>;
  };
  const archivedSet = new Set(archived);
  const unchanged = (await payload.harness.behavior.callRpc("sync", {
    since: { epoch: first.epoch, revision: first.revision },
  })) as { records: Record<string, unknown> };

  // 5,000 stored threads, read cold after each restart.
  const handlers: Handlers = {};
  const factory = capturing(handlers);
  let stored: Host = await load();
  await seed(
    stored.harness,
    Array.from({ length: 5_000 }, (_, index) => `s${index}`),
  );
  const handlerRuns: number[] = [];
  const callRuns: number[] = [];
  for (let run = 0; run < 7; run++) {
    stored = await stored.harness.lifecycle.reload(factory);
    let started = performance.now();
    await handlers.sync!({ since: null });
    handlerRuns.push(performance.now() - started);
    stored = await stored.harness.lifecycle.reload(factory);
    started = performance.now();
    await stored.harness.behavior.callRpc("sync", { since: null });
    callRuns.push(performance.now() - started);
  }

  return {
    signalsPerEvent,
    syncPayload: {
      threads: threadIds.length,
      archived: archived.length,
      firstRecords: Object.keys(first.records).length,
      firstArchivedRecords: Object.keys(first.records).filter((id) => archivedSet.has(id)).length,
      firstBytes: JSON.stringify(first).length,
      unchangedRecords: Object.keys(unchanged.records).length,
      unchangedBytes: JSON.stringify(unchanged).length,
    },
    firstRead: {
      handlerMs: Number(median(handlerRuns).toFixed(2)),
      callMs: Number(median(callRuns).toFixed(2)),
      threads: 5_000,
    },
  };
}
