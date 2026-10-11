import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, snoozedRow, type LifecycleRow } from "../shared/lifecycle";
import { reclaimNote } from "../shared/reclaim-note";
import { createLifecycleStore } from "./lifecycle-store";
import { createReclaimer } from "./reclaim";
import { createFakeRuntime, createFakeThreads, makeServerThread, memoryDatabase, pinned, terminal } from "./testing/fakes";

function setup(rowFor: LifecycleRow | null = parkedRow(5_000)) {
  const lifecycle = createLifecycleStore(memoryDatabase());
  if (rowFor !== null) lifecycle.putMany([["t", rowFor]]);
  const threads = createFakeThreads([makeServerThread("t")]);
  const runtime = createFakeRuntime();
  const warnings: string[] = [];
  const reclaim = createReclaimer({ lifecycle, threads, runtime, warn: (message) => warnings.push(message) });
  return { lifecycle, threads, runtime, reclaim, warnings, target: { threadId: "t", row: rowFor! } };
}

describe("Reclaim", () => {
  it("stops the runtime, closes the terminal nobody used, and leaves the one typed into (AC12)", async () => {
    const { runtime, reclaim } = setup(snoozedRow(90_000, 5_000));
    runtime.terminalsByThread.set("t", [terminal("idle"), terminal("typed", { lastUserInputAt: 7 })]);
    const report = await reclaim([{ threadId: "t", row: snoozedRow(90_000, 5_000) }]);
    expect(runtime.stopped).toEqual(["t"]);
    expect(runtime.closed).toEqual(["idle"]);
    expect(report).toEqual({ stoppedRuntime: true, closedTerminals: 1, keptTerminals: 1 });
    expect(reclaimNote(report)).toBe("Agent session stopped · closed 1 terminal nobody used · 1 terminal left running");
  });

  it("does not count a terminal that already exited or lost its machine as left running", async () => {
    const { runtime, reclaim, target } = setup();
    runtime.terminalsByThread.set("t", [
      terminal("done", { status: "exited" }),
      terminal("away", { status: "disconnected", lastUserInputAt: 3 }),
    ]);
    const report = await reclaim([target]);
    expect(runtime.closed).toEqual([]);
    expect(report).toEqual({ stoppedRuntime: true, closedTerminals: 0, keptTerminals: 0 });
  });

  it.each([
    ["pinned", (threads: ReturnType<typeof createFakeThreads>) => threads.threads.set("t", pinned(makeServerThread("t")))],
    ["busy", (threads: ReturnType<typeof createFakeThreads>) => threads.threads.set("t", makeServerThread("t", { status: "active" }))],
    ["waiting for the user", (threads: ReturnType<typeof createFakeThreads>) => threads.threads.set("t", makeServerThread("t", { hasPendingInteraction: true }))],
  ])("reclaims nothing from a thread that is %s", async (_name, change) => {
    const { runtime, threads, reclaim, target } = setup();
    runtime.terminalsByThread.set("t", [terminal("idle")]);
    change(threads);
    expect(await reclaim([target])).toEqual({ stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 });
    expect(runtime.stopped).toEqual([]);
    expect(runtime.closed).toEqual([]);
  });

  it("reclaims nothing from a thread whose row is no longer the one the action wrote", async () => {
    const { runtime, lifecycle, reclaim, target } = setup();
    lifecycle.putMany([["t", settledRow(6_000, "manual")]]);
    expect((await reclaim([target])).stoppedRuntime).toBe(false);
    expect(runtime.stopped).toEqual([]);
  });

  it("checks again before each terminal it closes, and stops at the first change", async () => {
    const { runtime, threads, reclaim, target } = setup();
    runtime.terminalsByThread.set("t", [terminal("one"), terminal("two"), terminal("three")]);
    runtime.onCall = (call) => {
      // The user starts a turn while the first terminal is being closed.
      if (call === "close one") threads.threads.set("t", makeServerThread("t", { status: "active" }));
    };
    const report = await reclaim([target]);
    expect(runtime.closed).toEqual(["one"]);
    expect(report).toEqual({ stoppedRuntime: true, closedTerminals: 1, keptTerminals: 0 });
  });

  it("leaves a terminal someone typed into after it was listed", async () => {
    const { runtime, reclaim, target } = setup();
    runtime.terminalsByThread.set("t", [terminal("late")]);
    runtime.onCall = (call) => {
      if (call === "terminal late") runtime.terminalsByThread.set("t", [terminal("late", { lastUserInputAt: 9 })]);
    };
    const report = await reclaim([target]);
    expect(runtime.closed).toEqual([]);
    expect(report.keptTerminals).toBe(1);
  });

  it("goes on to the terminals when the runtime cannot be stopped, and reports only what happened", async () => {
    const { runtime, reclaim, target, warnings } = setup();
    runtime.failStop.add("t");
    runtime.terminalsByThread.set("t", [terminal("idle")]);
    const report = await reclaim([target]);
    expect(report).toEqual({ stoppedRuntime: false, closedTerminals: 1, keptTerminals: 0 });
    expect(warnings[0]).toContain("could not stop the runtime of t");
  });

  it("never rejects: a failure reports less", async () => {
    const { runtime, threads, reclaim, target } = setup();
    runtime.terminals = async () => {
      throw new Error("offline");
    };
    expect(await reclaim([target])).toEqual({ stoppedRuntime: true, closedTerminals: 0, keptTerminals: 0 });
    threads.snapshot = async () => {
      throw new Error("bb is down");
    };
    expect(await reclaim([target])).toEqual({ stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 });
  });

  it("sums the reports of a tree's threads", async () => {
    const lifecycle = createLifecycleStore(memoryDatabase());
    const row = settledRow(5_000, "manual");
    lifecycle.putMany([["a", row], ["b", row]]);
    const threads = createFakeThreads([makeServerThread("a"), makeServerThread("b")]);
    const runtime = createFakeRuntime({ a: [terminal("a1")], b: [terminal("b1"), terminal("b2", { lastUserInputAt: 1 })] });
    const reclaim = createReclaimer({ lifecycle, threads, runtime });
    const report = await reclaim([{ threadId: "a", row }, { threadId: "b", row }]);
    expect(runtime.stopped.sort()).toEqual(["a", "b"]);
    expect(report).toEqual({ stoppedRuntime: true, closedTerminals: 2, keptTerminals: 1 });
  });
});
