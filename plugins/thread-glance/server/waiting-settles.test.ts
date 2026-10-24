import { beforeEach, describe, expect, it } from "vitest";
import { parkedRow, settledRow, waitingSettleRow } from "../shared/lifecycle";
import type { ChangeRecords } from "./actions";
import { createLifecycleStore, type LifecycleStore } from "./lifecycle-store";
import type { ReclaimTarget } from "./reclaim";
import { createFakeThreads, makeServerThread, memoryDatabase, type FakeThreads } from "./testing/fakes";
import { createWaitingSettles, IDLE_GRACE_MS, POLL_MS, type WaitingSettles } from "./waiting-settles";

const SINCE = 50_000;

let lifecycle: LifecycleStore;
let fake: FakeThreads;
let clock: number;
let touched: string[][];
let reclaimed: ReclaimTarget[][];
let warnings: string[];
let waiting: WaitingSettles;

function build(threads = [makeServerThread("parent"), makeServerThread("child", { parentThreadId: "parent", status: "active" })]) {
  lifecycle = createLifecycleStore(memoryDatabase());
  fake = createFakeThreads(threads);
  clock = SINCE + 1_000;
  touched = [];
  reclaimed = [];
  warnings = [];
  const change: ChangeRecords = async (write) => {
    const ids = new Set<string>();
    try {
      return await write((threadIds) => {
        for (const id of threadIds) ids.add(id);
      });
    } finally {
      if (ids.size > 0) touched.push([...ids]);
    }
  };
  lifecycle.putMany([["parent", waitingSettleRow(SINCE)]]);
  waiting = createWaitingSettles({
    lifecycle,
    threads: fake,
    change,
    now: () => clock,
    warn: (message) => warnings.push(message),
    reclaim: async (targets) => {
      reclaimed.push([...targets]);
      return { stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 };
    },
  });
}

const idle = (id: string) => fake.threads.set(id, { ...fake.threads.get(id)!, status: "idle" });

beforeEach(() => build());

describe("a waiting settle", () => {
  it("keeps waiting while a thread in the tree is busy", async () => {
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
    expect(touched).toEqual([]);
  });

  it("settles the whole tree, manually, once it has been idle for the grace, and reclaims it", async () => {
    idle("child");
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
    clock += IDLE_GRACE_MS;
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(settledRow(clock, "manual"));
    expect(lifecycle.get("child")).toEqual(settledRow(clock, "manual"));
    expect(touched).toEqual([["parent", "child"]]);
    expect(reclaimed[0]?.map((target) => target.threadId)).toEqual(["parent", "child"]);
  });

  it("waits the grace again when the tree was busy in between", async () => {
    idle("child");
    await waiting.check();
    // bb's notification turn on the parent, once the child's turn ended.
    fake.threads.set("parent", { ...fake.threads.get("parent")!, status: "active" });
    clock += IDLE_GRACE_MS;
    await waiting.check();
    idle("parent");
    clock += 1;
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
  });

  it("is not ended by a child's turn that simply ends, nor by an agent's message or spawn", async () => {
    fake.turns.set("child", [
      { kind: "ended", at: SINCE + 10, outcome: "completed" },
      { kind: "requested", at: SINCE + 20, byUser: false },
    ]);
    await waiting.check({ threadId: "child" });
    idle("child");
    await waiting.check();
    clock += IDLE_GRACE_MS;
    await waiting.check();
    expect(lifecycle.get("parent")?.settledKind).toBe("manual");
  });

  it("ends at once on a message the user sent into the tree, read from the turns bb recorded", async () => {
    fake.turns.set("child", [{ kind: "requested", at: SINCE + 10, byUser: true }]);
    await waiting.check({ threadId: "child" });
    expect(lifecycle.get("parent")).toBeNull();
    expect(touched).toEqual([["parent"]]);
  });

  it("ends on a failure the event reports, and on a pin or a question in the tree", async () => {
    await waiting.check({ threadId: "child", turns: [{ kind: "ended", at: clock, outcome: "failed" }] });
    expect(lifecycle.get("parent")).toBeNull();

    build();
    fake.threads.set("child", { ...fake.threads.get("child")!, isPinned: true });
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();

    build();
    fake.threads.set("child", { ...fake.threads.get("child")!, hasPendingInteraction: true });
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();
  });

  it("ends instead of landing when a turn of the user's or an interrupt shows before it lands", async () => {
    idle("child");
    fake.turns.set("child", [{ kind: "ended", at: SINCE + 10, outcome: "interrupted" }]);
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();
  });

  it("does not land while bb cannot say which turns the tree ran, and says why", async () => {
    idle("child");
    fake.failTurns.add("child");
    await waiting.check();
    clock += IDLE_GRACE_MS;
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
    expect(warnings[0]).toMatch(/could not read the turns/);
  });

  it("does not land on a tree that got busy again inside the change, and ends with the thread gone", async () => {
    idle("child");
    await waiting.check();
    clock += IDLE_GRACE_MS;
    // bb's second read, inside the change, finds the child working again.
    fake.beforeSnapshot = (call) => {
      if (call === 3) fake.threads.set("child", { ...fake.threads.get("child")!, status: "active" });
    };
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));

    fake.threads.delete("parent");
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();
  });

  it("leaves a settle cancelled or chosen again since it was decided on, and other rows of the tree", async () => {
    lifecycle.putMany([["child", parkedRow(SINCE - 5)]]);
    fake.beforeSnapshot = () => lifecycle.putMany([["parent", waitingSettleRow(SINCE + 500)]]);
    await waiting.check({ threadId: "child", turns: [{ kind: "ended", at: clock, outcome: "failed" }] });
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE + 500));
    expect(lifecycle.get("child")).toEqual(parkedRow(SINCE - 5));
  });

  it("is looked at every few seconds while one waits, and the loop ends with its signal", async () => {
    const naps: number[] = [];
    const controller = new AbortController();
    idle("child");
    waiting = createWaitingSettles({
      lifecycle,
      threads: fake,
      change: async (write) => write(() => undefined),
      now: () => clock,
      reclaim: async () => ({ stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 }),
      sleep: async (ms) => {
        naps.push(ms);
        clock += ms;
        if (naps.length === 3) controller.abort();
      },
    });
    await waiting.run(controller.signal);
    expect(naps).toEqual([POLL_MS, POLL_MS, POLL_MS]);
    expect(lifecycle.get("parent")?.settledKind).toBe("manual");
  });
});
