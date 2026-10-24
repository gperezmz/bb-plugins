import { beforeEach, describe, expect, it } from "vitest";
import { parkedRow, settledRow, waitingSettleRow } from "../shared/lifecycle";
import type { ChangeRecords } from "./actions";
import { createLifecycleStore, type LifecycleStore } from "./lifecycle-store";
import type { ReclaimTarget } from "./reclaim";
import { createFakeThreads, makeServerThread, memoryDatabase, pinned, type FakeThreads } from "./testing/fakes";
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

  it("ends on a message the user steered into a thread mid-turn, which no event announces, at the next check", async () => {
    fake.turns.set("child", [{ kind: "requested", at: SINCE + 10, byUser: true }]);
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();
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
    fake.threads.set("child", pinned(fake.threads.get("child")!, SINCE + 10));
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

  it("unpins the tree's pins from before it was chosen when it lands", async () => {
    fake.threads.set("parent", pinned(fake.threads.get("parent")!, SINCE - 10));
    idle("child");
    await waiting.check();
    expect(fake.calls).toEqual([]);
    clock += IDLE_GRACE_MS;
    await waiting.check();
    expect(fake.calls).toEqual(["unpin parent"]);
    expect(lifecycle.get("parent")?.settledKind).toBe("manual");
  });

  it("settles the tree when bb refuses an unpin partway through it, the refused thread keeping its pin", async () => {
    fake.threads.set("parent", pinned(fake.threads.get("parent")!, SINCE - 10));
    fake.threads.set("child", pinned({ ...fake.threads.get("child")!, status: "idle" }, SINCE - 10));
    fake.failUnpin.add("parent");
    await waiting.check();
    clock += IDLE_GRACE_MS;
    await waiting.check();
    expect(fake.calls).toEqual(["unpin parent", "unpin child"]);
    expect(fake.threads.get("parent")?.isPinned).toBe(true);
    expect(fake.threads.get("child")?.isPinned).toBe(false);
    expect(lifecycle.get("parent")?.settledKind).toBe("manual");
    expect(lifecycle.get("child")?.settledKind).toBe("manual");
    expect(warnings).toEqual([expect.stringMatching(/could not unpin parent/)]);
  });

  it("does not end on the first message of a thread being spawned, which bb records as the user's, though it already runs", async () => {
    fake.threads.set("spawned", makeServerThread("spawned", { parentThreadId: "parent", status: "pending", queuedWork: "waiting" }));
    await waiting.check({ threadId: "spawned", turns: [{ kind: "requested", at: SINCE + 10, byUser: true }] });
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
    // bb has started the child by the time the check reads it: it was created after the settle was chosen.
    fake.threads.set("spawned", makeServerThread("spawned", { parentThreadId: "parent", status: "active", createdAt: SINCE + 5 }));
    await waiting.check({ threadId: "spawned", turns: [{ kind: "requested", at: SINCE + 10, byUser: true }] });
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
  });

  it("gives the thread back the marks it had when it ends", async () => {
    lifecycle.putMany([["parent", waitingSettleRow(SINCE, parkedRow(SINCE - 5))]]);
    fake.threads.set("child", { ...fake.threads.get("child")!, hasPendingInteraction: true });
    await waiting.check();
    expect(lifecycle.get("parent")).toEqual(parkedRow(SINCE - 5));
  });

  it("does not end on the turns of a message the user had queued before choosing it", async () => {
    waiting.chosen("parent", [makeServerThread("parent"), makeServerThread("child", { parentThreadId: "parent", queuedWork: "waiting" })]);
    fake.turns.set("child", [{ kind: "requested", at: SINCE + 10, byUser: true }]);
    await waiting.check({ threadId: "child" });
    expect(lifecycle.get("parent")).toEqual(waitingSettleRow(SINCE));
    fake.turns.set("parent", [{ kind: "requested", at: SINCE + 20, byUser: true }]);
    await waiting.check({ threadId: "parent" });
    expect(lifecycle.get("parent")).toBeNull();
  });

  it("does not land a settle cancelled while the landing was being decided", async () => {
    idle("child");
    await waiting.check();
    clock += IDLE_GRACE_MS;
    // The user's Cancel reaches the server while the landing reads the tree's turns, before its change runs.
    const turnsSince = fake.turnsSince;
    fake.turnsSince = async (threadId, since) => {
      lifecycle.putMany([["parent", null]]);
      return turnsSince(threadId, since);
    };
    await waiting.check();
    expect(lifecycle.get("parent")).toBeNull();
    expect(lifecycle.get("child")).toBeNull();
    expect(reclaimed).toEqual([]);
  });

  it("answers checks asked for before one starts with one look at bb, reading each event's thread", async () => {
    const read: string[] = [];
    const turnsSince = fake.turnsSince;
    fake.turnsSince = async (threadId, since) => {
      read.push(threadId);
      return turnsSince(threadId, since);
    };
    const first = waiting.check();
    const second = waiting.check({ threadId: "child" });
    const third = waiting.check({ threadId: "parent" });
    expect(second).toBe(first);
    expect(third).toBe(first);
    await first;
    expect(fake.snapshots).toBe(1);
    expect(read.sort()).toEqual(["child", "parent"]);
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
