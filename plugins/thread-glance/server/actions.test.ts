import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeRow, parkedRow, settledRow, snoozedRow, type LifecycleRow } from "../shared/lifecycle";
import { busyRefusal, SETTLE_UNDO_GONE, SNOOZE_ENDED, TREE_CHANGED } from "../shared/messages";
import { createLifecycleActions, type ChangeRecords } from "./actions";
import { createLifecycleStore, type LifecycleStore } from "./lifecycle-store";
import type { ReclaimTarget } from "./reclaim";
import { createFakeThreads, makeServerThread, memoryDatabase, pinned, type FakeThreads } from "./testing/fakes";

const NOW = 100_000_000;
const HOUR = 3_600_000;

let lifecycle: LifecycleStore;
let fake: FakeThreads;
let touched: string[][];
let reclaimed: ReclaimTarget[][];
let clock: number;

function build(threads = [makeServerThread("t1")]) {
  lifecycle = createLifecycleStore(memoryDatabase());
  fake = createFakeThreads(threads);
  touched = [];
  reclaimed = [];
  clock = NOW;
  let token = 0;
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
  return createLifecycleActions({
    lifecycle,
    threads: fake,
    change,
    now: () => clock,
    newToken: () => `token-${(token += 1)}`,
    reclaim: async (targets) => {
      reclaimed.push([...targets]);
      return { stoppedRuntime: true, closedTerminals: 1, keptTerminals: 1 };
    },
  });
}

let actions: ReturnType<typeof build>;
beforeEach(() => {
  actions = build();
});

describe("snooze", () => {
  it("unpins, records the wake and snooze times, reclaims, and says what it did", async () => {
    actions = build([pinned(makeServerThread("t1"))]);
    const result = await actions.snooze("t1", NOW + 5 * HOUR);
    expect(fake.calls).toEqual(["unpin t1"]);
    const row = snoozedRow(NOW + 5 * HOUR, NOW);
    expect(lifecycle.get("t1")).toEqual(row);
    expect(result.changes).toEqual([{ threadId: "t1", before: null, after: row, unpinned: true }]);
    expect(reclaimed).toEqual([[{ threadId: "t1", row }]]);
    expect(result.note).toBe("Agent session stopped · closed 1 terminal nobody used · 1 terminal left running");
    expect(touched).toEqual([["t1"]]);
  });

  it("refuses a busy thread and changes nothing", async () => {
    actions = build([makeServerThread("t1", { title: "Fix login", status: "active" })]);
    await expect(actions.snooze("t1", NOW + HOUR)).rejects.toThrow(busyRefusal("snooze", "Fix login"));
    expect(lifecycle.get("t1")).toBeNull();
    expect(reclaimed).toEqual([]);
  });

  it("refuses a thread whose only sign of life is a running monitor", async () => {
    actions = build([makeServerThread("t1", { runtimeStatus: "active" })]);
    await expect(actions.snooze("t1", NOW + HOUR)).rejects.toThrow(/Cannot snooze while Thread t1 is working/);
    await expect(actions.park("t1")).rejects.toThrow(/Cannot park while/);
  });

  it("refuses a time in the past or more than a year ahead", async () => {
    await expect(actions.snooze("t1", NOW - 1)).rejects.toThrow("Pick a time in the future.");
    await expect(actions.snooze("t1", NOW + 366 * 24 * HOUR)).rejects.toThrow("Snooze for at most a year.");
    expect(lifecycle.get("t1")).toBeNull();
  });

  it("refuses a thread bb no longer has", async () => {
    await expect(actions.snooze("gone", NOW + HOUR)).rejects.toThrow("Thread is no longer available");
  });

  it("reclaims nothing visible when Reclaim fails, and still snoozes", async () => {
    lifecycle = createLifecycleStore(memoryDatabase());
    fake = createFakeThreads([makeServerThread("t1")]);
    const warn = vi.fn();
    const failing = createLifecycleActions({
      lifecycle,
      threads: fake,
      change: async (write) => write(() => undefined),
      now: () => NOW,
      reclaim: async () => {
        throw new Error("host offline");
      },
      warn,
    });
    const result = await failing.snooze("t1", NOW + HOUR);
    expect(result.note).toBeNull();
    expect(lifecycle.get("t1")).not.toBeNull();
    expect(warn).toHaveBeenCalledWith("reclaim failed: host offline");
  });
});

describe("park", () => {
  it("parks a thread and reclaims", async () => {
    const result = await actions.park("t1");
    expect(lifecycle.get("t1")).toEqual(parkedRow(NOW));
    expect(result.changes).toHaveLength(1);
    expect(reclaimed).toHaveLength(1);
  });

  it("changes nothing when the thread started a turn after the menu opened", async () => {
    actions = build([makeServerThread("t1")]);
    fake.threads.set("t1", makeServerThread("t1", { status: "active" }));
    await expect(actions.park("t1")).rejects.toThrow(/Cannot park while Thread t1 is working or waiting for input/);
    expect(lifecycle.get("t1")).toBeNull();
    expect(touched).toEqual([]);
  });
});

describe("resume and wake", () => {
  it("resumes a parked thread with the active override", async () => {
    await actions.park("t1");
    const result = await actions.resume("t1");
    expect(lifecycle.get("t1")).toEqual(activeRow());
    expect(result.changes[0]).toMatchObject({ before: parkedRow(NOW), after: activeRow() });
    expect(result.note).toBeNull();
  });

  it("wakes a snoozed thread now, and does nothing for one that is not snoozed", async () => {
    await actions.snooze("t1", NOW + HOUR);
    const woken = await actions.wake("t1");
    expect(lifecycle.get("t1")).toBeNull();
    expect(woken.changes).toHaveLength(1);
    expect((await actions.wake("t1")).changes).toEqual([]);
    await actions.park("t1");
    expect((await actions.wake("t1")).changes).toEqual([]);
    expect(lifecycle.get("t1")).toEqual(parkedRow(NOW));
  });
});

describe("undoLifecycle", () => {
  it("puts the row before back, and the pin", async () => {
    actions = build([pinned(makeServerThread("t1"))]);
    const done = await actions.snooze("t1", NOW + HOUR);
    const undone = await actions.undoLifecycle(done.changes);
    expect(lifecycle.get("t1")).toBeNull();
    expect(undone.skipped).toEqual([]);
    expect(fake.calls).toEqual(["unpin t1", "pin t1"]);
    expect(fake.threads.get("t1")?.isPinned).toBe(true);
  });

  it("re-snoozes after Wake now only while the old wake time is ahead", async () => {
    const snoozed = await actions.snooze("t1", NOW + HOUR);
    const woken = await actions.wake("t1");
    clock = NOW + 30 * 60_000;
    expect((await actions.undoLifecycle(woken.changes)).skipped).toEqual([]);
    expect(lifecycle.get("t1")).toEqual(snoozed.changes[0]!.after);
    const wokenAgain = await actions.wake("t1");
    clock = NOW + 2 * HOUR;
    const late = await actions.undoLifecycle(wokenAgain.changes);
    expect(late.skipped).toEqual([{ threadId: "t1", reason: SNOOZE_ENDED }]);
    expect(lifecycle.get("t1")).toBeNull();
  });

  it("skips a thread whose row changed since", async () => {
    const parked = await actions.park("t1");
    await actions.resume("t1");
    const undone = await actions.undoLifecycle(parked.changes);
    expect(undone.skipped).toEqual([{ threadId: "t1", reason: "It changed since." }]);
    expect(lifecycle.get("t1")).toEqual(activeRow());
  });
});

describe("settle", () => {
  const tree = () => [
    makeServerThread("parent", { title: "Parent" }),
    makeServerThread("child", { parentThreadId: "parent", title: "Child task" }),
    makeServerThread("grandchild", { parentThreadId: "child", title: "Grandchild" }),
    makeServerThread("sibling"),
  ];

  it("settles the whole tree under the thread, manually, and reclaims each thread", async () => {
    actions = build(tree());
    const result = await actions.settle("parent");
    expect(result.changes.map((entry) => entry.threadId).sort()).toEqual(["child", "grandchild", "parent"]);
    expect(lifecycle.get("parent")).toMatchObject({ settledKind: "manual", settledAt: NOW });
    expect(lifecycle.get("sibling")).toBeNull();
    expect(reclaimed[0]).toHaveLength(3);
    expect(result.undoToken).toBe("token-1");
    // Reclaim reported a note, so the toast lasts 10 s; Undo stays available past that.
    expect(result.undoUntil).toBe(NOW + 13_000);
  });

  it("gives Undo 4 s plus slack when nothing was reclaimed", async () => {
    lifecycle = createLifecycleStore(memoryDatabase());
    fake = createFakeThreads([makeServerThread("t1")]);
    const quiet = createLifecycleActions({
      lifecycle,
      threads: fake,
      change: async (write) => write(() => undefined),
      now: () => NOW,
      reclaim: async () => ({ stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 }),
    });
    expect((await quiet.settle("t1")).undoUntil).toBe(NOW + 7_000);
  });

  it("refuses when a thread in the tree is working, naming it, and changes nothing", async () => {
    const threads = tree();
    threads[1] = makeServerThread("child", { parentThreadId: "parent", title: "Child task", status: "active" });
    actions = build(threads);
    await expect(actions.settle("parent")).rejects.toThrow("Cannot settle while Child task is working or waiting for input");
    expect(lifecycle.all().size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("unpins the pinned threads of the tree", async () => {
    const threads = tree();
    threads[0] = pinned(threads[0]!);
    actions = build(threads);
    const result = await actions.settle("parent");
    expect(fake.calls).toEqual(["unpin parent"]);
    expect(result.changes.find((entry) => entry.threadId === "parent")?.unpinned).toBe(true);
  });

  it("restores the pins it removed, in place, when the tree changed meanwhile", async () => {
    const threads = [pinned(makeServerThread("a"), 5_000, "k1"), pinned(makeServerThread("parent"), 4_000, "k2"), pinned(makeServerThread("z"), 3_000, "k3")];
    actions = build(threads);
    // bb adds a child between the two reads of the tree.
    fake.beforeSnapshot = (call) => {
      if (call === 2) fake.threads.set("late", makeServerThread("late", { parentThreadId: "parent" }));
    };
    await expect(actions.settle("parent")).rejects.toThrow(TREE_CHANGED);
    expect(lifecycle.all().size).toBe(0);
    expect(fake.calls).toEqual(["unpin parent", "pin parent", "reorder parent a z"]);
    expect(fake.threads.get("parent")?.isPinned).toBe(true);
  });

  it("refuses with the tree-changed text when new attention arrived meanwhile", async () => {
    actions = build(tree());
    fake.beforeSnapshot = (call) => {
      if (call === 2) fake.threads.set("child", { ...fake.threads.get("child")!, latestAttentionAt: 9_999 });
    };
    await expect(actions.settle("parent")).rejects.toThrow(TREE_CHANGED);
    expect(lifecycle.all().size).toBe(0);
  });

  it("reports the pins it could not restore", async () => {
    actions = build([pinned(makeServerThread("parent", { title: "Parent" }))]);
    fake.beforeSnapshot = (call) => {
      if (call === 2) fake.threads.set("late", makeServerThread("late", { parentThreadId: "parent" }));
    };
    const pin = fake.pin;
    fake.pin = async () => {
      throw new Error("no");
    };
    await expect(actions.settle("parent")).rejects.toThrow(`${TREE_CHANGED}. Could not restore pins for: Parent`);
    fake.pin = pin;
  });

  describe("Undo", () => {
    it("returns the tree to its previous shelves while the toast shows, pins included", async () => {
      const threads = tree();
      threads[0] = pinned(threads[0]!);
      actions = build(threads);
      lifecycle.putMany([["child", parkedRow(NOW - HOUR)]]);
      const settled = await actions.settle("parent");
      clock = NOW + 3_000;
      const undone = await actions.undoSettle("parent", settled.undoToken);
      expect(undone.changes).toHaveLength(3);
      expect(lifecycle.get("parent")).toBeNull();
      expect(lifecycle.get("child")).toEqual(parkedRow(NOW - HOUR));
      expect(fake.threads.get("parent")?.isPinned).toBe(true);
      expect(fake.calls).toContain("pin parent");
    });

    it("keeps a thread that changed since", async () => {
      actions = build(tree());
      const settled = await actions.settle("parent");
      lifecycle.putMany([["child", activeRow()]]);
      const undone = await actions.undoSettle("parent", settled.undoToken);
      expect(undone.changes.map((entry) => entry.threadId).sort()).toEqual(["grandchild", "parent"]);
      expect(lifecycle.get("child")).toEqual(activeRow());
    });

    it("says it can no longer be undone once the toast cannot be pressed, or after a restart", async () => {
      actions = build(tree());
      const settled = await actions.settle("parent");
      clock = settled.undoUntil;
      await expect(actions.undoSettle("parent", settled.undoToken)).rejects.toThrow(SETTLE_UNDO_GONE);
      await expect(actions.undoSettle("parent", "token-never-issued")).rejects.toThrow(
        "This Settle can no longer be undone. Use Un-settle instead.",
      );
    });

    it("can be pressed once", async () => {
      actions = build(tree());
      const settled = await actions.settle("parent");
      await actions.undoSettle("parent", settled.undoToken);
      await expect(actions.undoSettle("parent", settled.undoToken)).rejects.toThrow(SETTLE_UNDO_GONE);
    });
  });
});

describe("unsettle", () => {
  it("returns the thread to Active, its settled descendants to the automatic rules, and reopens its ancestors", async () => {
    actions = build([
      makeServerThread("root"),
      makeServerThread("mid", { parentThreadId: "root" }),
      makeServerThread("leaf", { parentThreadId: "mid" }),
      makeServerThread("kid", { parentThreadId: "leaf" }),
      makeServerThread("busyKid", { parentThreadId: "leaf" }),
    ]);
    lifecycle.putMany([
      ["root", settledRow(10, "auto")],
      ["mid", parkedRow(10)],
      ["leaf", settledRow(10, "manual")],
      ["kid", settledRow(10, "manual")],
      ["busyKid", activeRow()],
    ]);
    const result = await actions.unsettle("leaf");
    expect(lifecycle.get("leaf")).toEqual(activeRow());
    expect(lifecycle.get("kid")).toBeNull();
    expect(lifecycle.get("busyKid")).toEqual(activeRow());
    expect(lifecycle.get("mid")).toBeNull();
    expect(lifecycle.get("root")).toBeNull();
    expect(result.changes.map((entry) => entry.threadId).sort()).toEqual(["kid", "leaf", "mid", "root"]);
  });

  it("leaves an ancestor that only carries the active override", async () => {
    actions = build([makeServerThread("root"), makeServerThread("leaf", { parentThreadId: "root" })]);
    lifecycle.putMany([["root", activeRow()], ["leaf", settledRow(1, "manual")]]);
    await actions.unsettle("leaf");
    expect(lifecycle.get("root")).toEqual(activeRow());
  });
});

describe("dismissWoke and clearPinned", () => {
  it("clears a woke row, and leaves a snooze that has not woken", async () => {
    const asleep: LifecycleRow = snoozedRow(NOW + HOUR, NOW - HOUR);
    lifecycle.putMany([["t1", asleep]]);
    expect((await actions.dismissWoke("t1")).changes).toEqual([]);
    expect(lifecycle.get("t1")).toEqual(asleep);
    clock = NOW + 2 * HOUR;
    expect((await actions.dismissWoke("t1")).changes).toHaveLength(1);
    expect(lifecycle.get("t1")).toBeNull();
  });

  it("clears a woke row when attention came after the snooze", async () => {
    actions = build([makeServerThread("t1", { latestAttentionAt: NOW })]);
    lifecycle.putMany([["t1", snoozedRow(NOW + HOUR, NOW - HOUR)]]);
    await actions.dismissWoke("t1");
    expect(lifecycle.get("t1")).toBeNull();
  });

  it("clears the row of a pinned thread only", async () => {
    actions = build([makeServerThread("a"), pinned(makeServerThread("b"))]);
    lifecycle.putMany([["a", settledRow(1, "manual")], ["b", settledRow(1, "manual")]]);
    expect((await actions.clearPinned("a")).changes).toEqual([]);
    expect(lifecycle.get("a")).not.toBeNull();
    expect((await actions.clearPinned("b")).changes).toHaveLength(1);
    expect(lifecycle.get("b")).toBeNull();
  });
});
