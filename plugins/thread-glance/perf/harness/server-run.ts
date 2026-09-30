// The plugin server's figures, on bb's fake plugin host: realtime signals per
// thread event, the stamps and notes a mount loads, and the first read of
// them after a server start with 5,000 stored threads. The fake host keeps
// KV in memory, so the read time stands in for the SQLite-backed benchmark
// B25 names until that benchmark exists.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

export interface ServerFigures {
  /** Realtime signals one thread event publishes, by event. */
  signalsPerEvent: Record<string, number>;
  /** Bytes of the stamps and notes a mount loads, with every thread of a list stamped and noted. */
  mountPayloadBytes: { stamps: number; notes: number; threads: number };
  /** First `listStamps` and `listNotes` after a restart over 5,000 stored threads, in ms. */
  firstRead: { stampsMs: number; notesMs: number; threads: number };
}

type Harness = Awaited<ReturnType<typeof load>>["harness"];

async function load() {
  const host = createFakePluginHost({ pluginId: "thread-glance" });
  await plugin(host.bb);
  return host;
}

/** Every thread in `ids` runs one turn to a finish with a note. */
async function seed(harness: Harness, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const thread = makeThreadResponse({ id });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: `Finished ${id}.` });
  }
}

export async function runServer(threadIds: readonly string[]): Promise<ServerFigures> {
  const { harness } = await load();
  const thread = makeThreadResponse({ id: "t_signals" });
  const events: [string, () => Promise<unknown>][] = [
    ["thread.active", () => harness.behavior.emitThreadEvent("thread.active", { thread })],
    ["interaction.pending", () => harness.behavior.emitThreadEvent("interaction.pending", { thread, interaction: {} as never })],
    ["thread.idle", () => harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: "Done." })],
    ["thread.failed", () => harness.behavior.emitThreadEvent("thread.failed", { thread, error: null })],
    [
      "turn.failed",
      () =>
        harness.behavior.emitThreadEvent("turn.failed", {
          threadId: thread.id,
          turnId: "turn_1",
          errorInfo: { message: "Out of credits" },
        } as never),
    ],
  ];
  const signalsPerEvent: Record<string, number> = {};
  for (const [name, emit] of events) {
    const before = harness.inspection.realtimeSignals.length;
    await emit();
    signalsPerEvent[name] = harness.inspection.realtimeSignals.length - before;
  }

  await seed(harness, threadIds);
  const stamps = JSON.stringify(await harness.behavior.callRpc("listStamps", null)).length;
  const notes = JSON.stringify(await harness.behavior.callRpc("listNotes", null)).length;

  const stored = await load();
  await seed(
    stored.harness,
    Array.from({ length: 5_000 }, (_, index) => `s${index}`),
  );
  const restarted = await stored.harness.lifecycle.reload(plugin);
  let started = performance.now();
  await restarted.harness.behavior.callRpc("listStamps", null);
  const stampsMs = performance.now() - started;
  started = performance.now();
  await restarted.harness.behavior.callRpc("listNotes", null);
  const notesMs = performance.now() - started;

  return {
    signalsPerEvent,
    mountPayloadBytes: { stamps, notes, threads: threadIds.length },
    firstRead: { stampsMs: Number(stampsMs.toFixed(2)), notesMs: Number(notesMs.toFixed(2)), threads: 5_000 },
  };
}
