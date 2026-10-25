import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { activeRow, parkedRow, settledRow, snoozedRow, waitingSettleRow } from "../shared/lifecycle";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { CHANNELS, type RecordsSignal, type ThreadRecord, type Versioned } from "../shared/signals";
import { createLifecycleStore } from "./lifecycle-store";
import { createOrderStore } from "./order-store";
import { listedThread, sdkWith } from "./testing/fakes";

type Overrides = NonNullable<Parameters<typeof createFakePluginHost>[0]>["sdk"];

const hosts: { harness: { lifecycle: { dispose(): Promise<void> } } }[] = [];

async function load(sdk: Overrides = {}) {
  const host = createFakePluginHost({ pluginId: "thread-glance", sdk });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}
type Harness = Awaited<ReturnType<typeof load>>["harness"];

interface SyncAnswer {
  epoch: string;
  revision: number;
  full: boolean;
  records: Record<string, ThreadRecord>;
  settings: Versioned<typeof DEFAULT_SETTINGS>;
  order: Versioned<string[]>;
  appearance: Versioned<{ colours: Record<string, string>; icons: Record<string, unknown> }>;
}

async function sync(harness: Harness, since: { epoch: string; revision: number } | null = null) {
  return (await harness.behavior.callRpc("sync", { since })) as SyncAnswer;
}

const signalsOn = (harness: Harness, channel: string) =>
  harness.inspection.realtimeSignals.filter((signal) => signal.channel === channel).map((signal) => signal.payload);

/** A thread's row in an answer: a full `sync` leaves out a thread with none. */
const rowOf = (answer: SyncAnswer, threadId: string) => answer.records[threadId]?.lifecycle ?? null;

const recordSignals = (harness: Harness) => signalsOn(harness, CHANNELS.records) as RecordsSignal[];

afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

describe("sync", () => {
  it("answers with the defaults, an empty order and no records on a fresh install", async () => {
    const { harness } = await load();
    const answer = await sync(harness);
    expect(answer).toMatchObject({ full: true, records: {} });
    expect(answer.settings.value).toEqual(DEFAULT_SETTINGS);
    expect(answer.settings.value.inactiveShelf).toBe(true);
    expect(answer.order.value).toEqual([]);
    expect(answer.appearance.value).toEqual({ colours: {}, icons: {} });
  });

  it("answers a window that is up to date with only what changed since", async () => {
    const { harness } = await load(sdkWith(() => [listedThread("a"), listedThread("b")]));
    await harness.behavior.callRpc("park", { threadId: "a" });
    const first = await sync(harness);
    await harness.behavior.callRpc("park", { threadId: "b" });
    const next = await sync(harness, { epoch: first.epoch, revision: first.revision });
    expect(next.full).toBe(false);
    expect(Object.keys(next.records)).toEqual(["b"]);
    expect(Object.keys(first.records)).toEqual(["a"]);
    const other = await sync(harness, { epoch: "another-epoch", revision: 99 });
    expect(other.full).toBe(true);
    expect(Object.keys(other.records).sort()).toEqual(["a", "b"]);
  });
});

describe("lifecycle actions over RPC", () => {
  it("snoozes a thread, sends its record as one signal and travels in sync", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("a")]));
    const result = (await harness.behavior.callRpc("snooze", { threadId: "a", until: 60_000 })) as {
      changes: { threadId: string }[];
      note: string | null;
    };
    expect(result.changes.map((entry) => entry.threadId)).toEqual(["a"]);
    expect(result.note).toBeNull();
    expect(recordSignals(harness).map((signal) => signal.records)).toEqual([
      { a: { lifecycle: snoozedRow(60_000, 10_000) } },
    ]);
    expect((await sync(harness)).records.a).toEqual({ lifecycle: snoozedRow(60_000, 10_000) });
  });

  it("refuses to snooze a busy thread and a time in the past, and publishes nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("busy", { title: "Fix login", status: "active" }), listedThread("a")]));
    await expect(harness.behavior.callRpc("snooze", { threadId: "busy", until: 60_000 })).rejects.toThrow(
      "Cannot snooze while Fix login is working or waiting for input",
    );
    await expect(harness.behavior.callRpc("snooze", { threadId: "a", until: 5_000 })).rejects.toThrow("Pick a time in the future.");
    expect(recordSignals(harness)).toEqual([]);
  });

  describe("a Settle of a parent with a working child", () => {
    const family = () => [
      listedThread("parent"),
      listedThread("child", { parentThreadId: "parent", title: "Run the migration", runtime: { displayStatus: "active" } }),
    ];
    /** bb's turn events for each thread, newest first, as `threads.events.list` answers with `order: "desc"`. */
    const eventsOf = (turns: Record<string, { type: string; createdAt: number; data: Record<string, unknown> }[]>) => ({
      threads: {
        events: {
          async list({ threadId, beforeSeq }: { threadId: string; beforeSeq?: string }) {
            if (beforeSeq !== undefined) return [];
            return (turns[threadId] ?? []).map((row, index) => ({ id: `${threadId}-${index}`, seq: 100 - index, threadId, scope: { kind: "thread" }, ...row }));
          },
        },
      },
    });

    it("waits, keeps the waiting settle in sync, and settles the tree once it has been idle a while", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = family();
      const { harness } = await load(sdkWith(() => threads, undefined, eventsOf({})));
      const result = (await harness.behavior.callRpc("settle", { threadId: "parent" })) as { waiting: boolean };
      expect(result.waiting).toBe(true);
      expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000));
      // The child's turn ends; the tree is idle, and stays so past the grace.
      Object.assign(threads[1]!, { runtime: { displayStatus: "idle" } });
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }), lastAssistantText: null });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
      vi.setSystemTime(16_000);
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "parent" }), lastAssistantText: null });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toMatchObject({ settledKind: "manual", waitingSettleAt: null }));
      const answer = await sync(harness);
      expect(rowOf(answer, "child")).toEqual(rowOf(answer, "parent"));
    });

    it("ends the wait on a message the user sent into the tree, and on Cancel", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const turns: Record<string, { type: string; createdAt: number; data: Record<string, unknown> }[]> = {};
      const threads = family();
      const { harness } = await load(sdkWith(() => threads, undefined, eventsOf(turns)));
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      // An agent's message to the parent leaves it waiting.
      turns.parent = [{ type: "client/turn/requested", createdAt: 11_000, data: { source: "tell", initiator: "agent", senderThreadId: "child" } }];
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "parent" }) });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
      // An agent's spawn, as bb records it: the user's, with no sender. It leaves the wait, as does the spawn's first message queued.
      threads.push(listedThread("spawned", { parentThreadId: "parent", status: "pending" }));
      turns.spawned = [{ type: "client/turn/requested", createdAt: 11_500, data: { source: "spawn", initiator: "user", senderThreadId: null, target: { kind: "thread-start" } } }];
      await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "spawned", parentThreadId: "parent" }) });
      await harness.behavior.emitThreadEvent("message.queued", {
        entry: makeQueueEntry({ threadId: "spawned", initiator: "user", senderThreadId: null, createdAt: 11_500 }),
      });
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "spawned", parentThreadId: "parent" }) });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
      turns.parent.unshift({ type: "client/turn/requested", createdAt: 12_000, data: { source: "tell", initiator: "user", senderThreadId: null } });
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "parent" }) });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toBeNull());
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      expect(rowOf(await sync(harness), "parent")?.waitingSettleAt).not.toBeNull();
      await harness.behavior.callRpc("cancelSettle", { threadId: "parent" });
      expect(rowOf(await sync(harness), "parent")).toBeNull();
    });

    it("ends the wait on an interrupt bb only records in the turn's end, before the tree lands", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = family();
      const turns: Record<string, { type: string; createdAt: number; data: Record<string, unknown> }[]> = {};
      const { harness } = await load(sdkWith(() => threads, undefined, eventsOf(turns)));
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      Object.assign(threads[1]!, { runtime: { displayStatus: "idle" } });
      turns.child = [{ type: "turn/completed", createdAt: 11_000, data: { status: "interrupted", providerThreadId: null } }];
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }), lastAssistantText: null });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toBeNull());
      expect(rowOf(await sync(harness), "child")).toBeNull();
    });

    it("ends the wait on a failure bb announces in the tree", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { harness } = await load(sdkWith(family, undefined, eventsOf({})));
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      vi.setSystemTime(11_000);
      await harness.behavior.emitThreadEvent("thread.failed", { thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }), error: null });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toBeNull());
    });

    it("ends the wait on a message the user queues in the tree, not on one an agent queues", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { harness } = await load(sdkWith(family, undefined, eventsOf({})));
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      await harness.behavior.emitThreadEvent("message.queued", {
        entry: makeQueueEntry({ threadId: "child", initiator: "agent", senderThreadId: "parent", createdAt: 11_000 }),
      });
      await harness.behavior.emitThreadEvent("message.queued", {
        entry: makeQueueEntry({ threadId: "child", initiator: "user", senderThreadId: "other-thread", createdAt: 11_000 }),
      });
      await harness.behavior.emitThreadEvent("message.queued", {
        entry: makeQueueEntry({ threadId: "child", initiator: "user", senderThreadId: null, createdAt: 9_000 }),
      });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
      await harness.behavior.emitThreadEvent("message.queued", {
        entry: makeQueueEntry({ threadId: "child", initiator: "user", senderThreadId: null, createdAt: 11_000 }),
      });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toBeNull());
    });

    it("keeps the wait when a message the user had queued before choosing Settle is sent", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = [listedThread("parent"), listedThread("child", { parentThreadId: "parent", queuedWork: "waiting" })];
      const turns: Record<string, { type: string; createdAt: number; data: Record<string, unknown> }[]> = {};
      const { harness } = await load(sdkWith(() => threads, undefined, eventsOf(turns)));
      expect(((await harness.behavior.callRpc("settle", { threadId: "parent" })) as { waiting: boolean }).waiting).toBe(true);
      // bb sends the queued message once the child is free: a turn the user asked for, recorded after the settle.
      turns.child = [{ type: "client/turn/requested", createdAt: 12_000, data: { source: "tell", initiator: "user", senderThreadId: null } }];
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }) });
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "parent" }), lastAssistantText: null });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
      // The same turn on the parent, which had nothing queued, is the user's own.
      turns.parent = [{ type: "client/turn/requested", createdAt: 13_000, data: { source: "tell", initiator: "user", senderThreadId: null } }];
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "parent" }) });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toBeNull());
    });

    it("keeps the wait when a child's turn reopens its parked parent", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = family();
      const { harness } = await load(sdkWith(() => threads, undefined, eventsOf({})));
      await harness.behavior.callRpc("park", { threadId: "parent" });
      await harness.behavior.callRpc("settle", { threadId: "parent" });
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "child", parentThreadId: "parent" }) });
      await vi.waitFor(async () => expect(rowOf(await sync(harness), "parent")).toEqual(waitingSettleRow(10_000)));
    });

    it("refuses while a question waits below, naming the child", async () => {
      const { harness } = await load(
        sdkWith(() => [listedThread("parent"), listedThread("child", { parentThreadId: "parent", title: "Ask", hasPendingInteraction: true })]),
      );
      await expect(harness.behavior.callRpc("settle", { threadId: "parent" })).rejects.toThrow("Cannot settle while a child thread needs you: Ask");
    });
  });

  it("settles a tree, undoes it from the snapshot, and says so when the snapshot is gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("parent"), listedThread("child", { parentThreadId: "parent" })]));
    const settled = (await harness.behavior.callRpc("settle", { threadId: "parent" })) as { undoToken: string; undoUntil: number };
    expect((await sync(harness)).records.child?.lifecycle).toEqual(settledRow(10_000, "manual"));
    await harness.behavior.callRpc("undoSettle", { threadId: "parent", undoToken: settled.undoToken });
    expect(rowOf(await sync(harness), "child")).toBeNull();
    await expect(
      harness.behavior.callRpc("undoSettle", { threadId: "parent", undoToken: settled.undoToken }),
    ).rejects.toThrow("This Settle can no longer be undone. Use Un-settle instead.");
  });

  it("clears the row of a pinned thread when asked", async () => {
    const threads = [listedThread("a", { pinnedAt: 5 })];
    const { harness } = await load(sdkWith(() => threads));
    await harness.behavior.callRpc("resume", { threadId: "a" });
    expect((await sync(harness)).records.a?.lifecycle).toEqual(activeRow());
    await harness.behavior.callRpc("clearPinned", { threadId: "a" });
    expect(rowOf(await sync(harness), "a")).toBeNull();
  });
});

describe("events", () => {
  it("puts a new visible thread at the top of the manual order, and not a hidden one", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "a" }) });
    await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "b" }) });
    await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "helper", visibility: "hidden" }) });
    expect((await sync(harness)).order.value).toEqual(["b", "a"]);
    expect((signalsOn(harness, CHANNELS.order) as Versioned<string[]>[]).map((signal) => signal.value)).toEqual([["a"], ["b", "a"]]);
  });

  it("orders the subset a reorder names and leaves other places", async () => {
    const { harness } = await load();
    for (const id of ["a", "b", "c", "d"]) await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id }) });
    expect((await sync(harness)).order.value).toEqual(["d", "c", "b", "a"]);
    const reordered = (await harness.behavior.callRpc("reorder", { threadIds: ["a", "c"] })) as Versioned<string[]>;
    expect(reordered.value).toEqual(["d", "a", "b", "c"]);
    expect((await sync(harness)).order.value).toEqual(["d", "a", "b", "c"]);
  });

  it("reopens the parked, snoozed and settled ancestors of a child that is created or starts a turn", async () => {
    const threads = [
      listedThread("root"),
      listedThread("mid", { parentThreadId: "root" }),
      listedThread("leaf", { parentThreadId: "mid" }),
    ];
    const { harness } = await load(sdkWith(() => threads));
    await harness.behavior.callRpc("park", { threadId: "root" });
    await harness.behavior.callRpc("settle", { threadId: "mid" });
    const child = makeThreadResponse({ id: "new", parentThreadId: "mid" });
    await harness.behavior.emitThreadEvent("thread.created", { thread: child });
    const after = await sync(harness);
    expect(rowOf(after, "root")).toBeNull();
    expect(rowOf(after, "mid")).toBeNull();
  });

  it("reopens a snoozed ancestor when a child starts a turn", async () => {
    const threads = [listedThread("root"), listedThread("kid", { parentThreadId: "root" })];
    const { harness } = await load(sdkWith(() => threads));
    await harness.behavior.callRpc("snooze", { threadId: "root", until: Date.now() + 3_600_000 });
    expect(rowOf(await sync(harness), "root")).not.toBeNull();
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "kid", parentThreadId: "root" }) });
    expect(rowOf(await sync(harness), "root")).toBeNull();
  });

  describe("while a question waits below a marked thread", () => {
    const tree = () => [
      listedThread("root", { latestAttentionAt: 1_000 }),
      listedThread("mid", { parentThreadId: "root" }),
      listedThread("leaf", { parentThreadId: "mid", hasPendingInteraction: true }),
    ];

    it.each([
      ["parks", async (harness: Harness) => harness.behavior.callRpc("park", { threadId: "root" }), 10_000],
      ["snoozes", async (harness: Harness) => harness.behavior.callRpc("snooze", { threadId: "root", until: 90_000 }), 10_000],
    ])("keeps the mark of a root that %s through the turns bb starts for the question", async (_name, setAside, markedAt) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(markedAt);
      // `leaf` asks first, so the root cannot be set aside by hand: the question arrives after.
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      const { harness } = await load(sdkWith(() => threads));
      await setAside(harness);
      const before = rowOf(await sync(harness), "root")!;
      threads[2]!.hasPendingInteraction = true;

      // bb tells the asking thread's parent, which starts a turn; that turn ends, and the root hears of it in turn.
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "mid", parentThreadId: "root" }) });
      threads[0]!.latestAttentionAt = 20_000;
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 20_000 }) });
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({ id: "root", latestAttentionAt: 21_000 }),
        lastAssistantText: null,
      });
      expect(rowOf(await sync(harness), "root")).toEqual({ ...before, heldAttentionAt: 21_000 });

      // The answer: nothing new waits, so the mark is still there, and attention that follows clears it as before.
      threads[2]!.hasPendingInteraction = false;
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({ id: "root", latestAttentionAt: 21_000 }),
        lastAssistantText: null,
      });
      expect(rowOf(await sync(harness), "root")).toEqual({ ...before, heldAttentionAt: 21_000 });
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({ id: "root", latestAttentionAt: 30_000 }),
        lastAssistantText: null,
      });
      const after = rowOf(await sync(harness), "root");
      if (before.parkedAt !== null) expect(after).toBeNull();
      else expect(after).toEqual({ ...before, heldAttentionAt: 21_000 });
    });

    it("holds the end of a turn that began while the question waited, though the answer came before it ended", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      const { harness } = await load(sdkWith(() => threads));
      await harness.behavior.callRpc("park", { threadId: "root" });
      const before = rowOf(await sync(harness), "root")!;
      threads[2]!.hasPendingInteraction = true;
      // bb's turn on the root starts while the child asks ...
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 12_000 }) });
      // ... the user answers, and only then does the turn end.
      threads[2]!.hasPendingInteraction = false;
      threads[0]!.latestAttentionAt = 25_000;
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 25_000 }), lastAssistantText: null });
      expect(rowOf(await sync(harness), "root")).toEqual({ ...before, heldAttentionAt: 25_000 });
      // The next turn begins after the answer, so it clears the mark as before.
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 25_000 }) });
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 40_000 }), lastAssistantText: null });
      expect(rowOf(await sync(harness), "root")).toBeNull();
    });

    it("keeps the hold of a turn's end when bb cannot list its threads then, and applies it at the next event", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      let listing = true;
      const { harness } = await load(sdkWith(() => (listing ? threads : Promise.reject(new Error("bb is busy")) as never)));
      await harness.behavior.callRpc("park", { threadId: "root" });
      const before = rowOf(await sync(harness), "root")!;
      threads[2]!.hasPendingInteraction = true;
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 12_000 }) });
      threads[2]!.hasPendingInteraction = false;
      threads[0]!.latestAttentionAt = 25_000;
      listing = false;
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 25_000 }), lastAssistantText: null });
      listing = true;
      expect(rowOf(await sync(harness), "root")).toEqual({ ...before, heldAttentionAt: 12_000 });
      await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 25_000 }), lastAssistantText: null });
      expect(rowOf(await sync(harness), "root")).toEqual({ ...before, heldAttentionAt: 25_000 });
    });

    it("leaves a marked root alone when a thread is created below it while a question waits, and reopens it otherwise", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      const { harness } = await load(sdkWith(() => threads));
      await harness.behavior.callRpc("park", { threadId: "root" });
      threads[2]!.hasPendingInteraction = true;
      await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "new", parentThreadId: "mid" }) });
      expect(rowOf(await sync(harness), "root")).not.toBeNull();
      threads[2]!.hasPendingInteraction = false;
      await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "newer", parentThreadId: "mid" }) });
      expect(rowOf(await sync(harness), "root")).toBeNull();
    });

    it("keeps a settled mark, which a child's turn would clear, while a question waits below", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      const { harness } = await load(sdkWith(() => threads));
      await harness.behavior.callRpc("settle", { threadId: "root" });
      expect(rowOf(await sync(harness), "mid")).not.toBeNull();
      threads[2]!.hasPendingInteraction = true;
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "leaf", parentThreadId: "mid" }) });
      const held = await sync(harness);
      expect(rowOf(held, "root")).not.toBeNull();
      expect(rowOf(held, "mid")).not.toBeNull();
      threads[2]!.hasPendingInteraction = false;
      await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "leaf", parentThreadId: "mid" }) });
      const after = await sync(harness);
      expect(rowOf(after, "root")).toBeNull();
      expect(rowOf(after, "mid")).toBeNull();
    });

    it("lets the root's own question return it to Active as before, though a child waits too", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const threads = tree().map((thread) => (thread.id === "leaf" ? { ...thread, hasPendingInteraction: false } : thread));
      const { harness } = await load(sdkWith(() => threads));
      await harness.behavior.callRpc("park", { threadId: "root" });
      threads[2]!.hasPendingInteraction = true;
      threads[0]!.hasPendingInteraction = true;
      threads[0]!.latestAttentionAt = 20_000;
      await harness.behavior.emitThreadEvent("interaction.pending", { thread: makeThreadResponse({ id: "root", latestAttentionAt: 20_000 }) } as never);
      expect(rowOf(await sync(harness), "root")).toBeNull();
    });
  });

  it("clears the active override when the thread starts a turn", async () => {
    const { harness } = await load(sdkWith(() => [listedThread("a")]));
    await harness.behavior.callRpc("resume", { threadId: "a" });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "a" }) });
    expect(rowOf(await sync(harness), "a")).toBeNull();
  });

  it("returns a parked thread with new attention to Active and clears the mark, so auto-settle may settle it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("a")]));
    await harness.behavior.callRpc("park", { threadId: "a" });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "a", latestAttentionAt: 9_000 }),
      lastAssistantText: null,
    });
    expect((await sync(harness)).records.a?.lifecycle).toEqual(parkedRow(10_000));
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "a", latestAttentionAt: 20_000 }),
      lastAssistantText: null,
    });
    expect(rowOf(await sync(harness), "a")).toBeNull();
  });

  it("publishes one records signal holding only the record of the thread an event changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("a"), listedThread("b"), listedThread("c")]));
    await harness.behavior.callRpc("park", { threadId: "a" });
    await harness.behavior.callRpc("park", { threadId: "b" });
    await harness.behavior.callRpc("resume", { threadId: "c" });
    const before = recordSignals(harness).length;

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "a", latestAttentionAt: 20_000 }),
      lastAssistantText: null,
    });
    expect(recordSignals(harness).slice(before).map((signal) => Object.keys(signal.records))).toEqual([["a"]]);

    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "c" }) });
    expect(recordSignals(harness).slice(before).map((signal) => Object.keys(signal.records))).toEqual([["a"], ["c"]]);

    await harness.behavior.callRpc("snooze", { threadId: "a", until: 60_000 });
    expect(recordSignals(harness).slice(before).map((signal) => Object.keys(signal.records))).toEqual([["a"], ["c"], ["a"]]);
    expect(recordSignals(harness).at(-1)?.records).toEqual({ a: { lifecycle: snoozedRow(60_000, 10_000) } });
  });

  it("keeps a snooze when attention arrives, since the row is what makes the thread Woke", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load(sdkWith(() => [listedThread("a")]));
    await harness.behavior.callRpc("snooze", { threadId: "a", until: 90_000 });
    await harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "a", latestAttentionAt: 20_000 }),
      error: null,
    });
    expect((await sync(harness)).records.a?.lifecycle).toEqual(snoozedRow(90_000, 10_000));
  });

  it("forgets the row and the order entry of a deleted thread, and the order entry of an archived one", async () => {
    const { harness } = await load(sdkWith(() => [listedThread("a"), listedThread("b")]));
    await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "a" }) });
    await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "b" }) });
    await harness.behavior.callRpc("park", { threadId: "a" });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "a" }) });
    await harness.behavior.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id: "b" }) });
    const answer = await sync(harness);
    expect(answer.order.value).toEqual([]);
    expect(rowOf(answer, "a")).toBeNull();
    expect(recordSignals(harness).at(-1)?.records).toEqual({ a: { lifecycle: null } });
    await harness.behavior.emitThreadEvent("thread.unarchived", { thread: makeThreadResponse({ id: "b" }) });
    expect((await sync(harness)).order.value).toEqual(["b"]);
  });
});

describe("settings", () => {
  it("stores only the edited fields, publishes the whole record and returns it with a version", async () => {
    const { harness } = await load();
    const first = (await sync(harness)).settings;
    const written = (await harness.behavior.callRpc("writeSettings", { patch: { workingShelf: true } })) as Versioned<typeof DEFAULT_SETTINGS>;
    expect(written.value).toEqual({ ...DEFAULT_SETTINGS, workingShelf: true });
    expect(written.version).toBeGreaterThan(first.version);
    expect(signalsOn(harness, CHANNELS.settings)).toEqual([written]);
    expect((await sync(harness)).settings.value.workingShelf).toBe(true);
  });

  it("publishes nothing for a write that changes nothing", async () => {
    const { harness } = await load();
    await harness.behavior.callRpc("writeSettings", { patch: { inactiveShelf: true } });
    expect(signalsOn(harness, CHANNELS.settings)).toEqual([]);
  });

  it("refuses days before auto-settle of 0 and saves nothing, even with a valid field beside it", async () => {
    const { harness } = await load();
    await expect(
      harness.behavior.callRpc("writeSettings", { patch: { daysBeforeAutoSettle: 0, workingShelf: true } }),
    ).rejects.toThrow(/daysBeforeAutoSettle: Use at least 1 day/);
    expect((await sync(harness)).settings.value).toEqual(DEFAULT_SETTINGS);
    expect(signalsOn(harness, CHANNELS.settings)).toEqual([]);
  });

  it("refuses a snooze shortcuts list with one invalid entry, with the reason", async () => {
    const { harness } = await load();
    await expect(
      harness.behavior.callRpc("writeSettings", { patch: { snoozeShortcuts: "1h, soonish, tomorrow@09:00" } }),
    ).rejects.toThrow(/soonish/);
  });

  it("resets named settings, or all", async () => {
    const { harness } = await load();
    await harness.behavior.callRpc("writeSettings", { patch: { workingShelf: true, dockShelves: true, hoursBeforeInactive: 12 } });
    const some = (await harness.behavior.callRpc("resetSettings", { keys: ["workingShelf"] })) as Versioned<typeof DEFAULT_SETTINGS>;
    expect(some.value).toMatchObject({ workingShelf: false, dockShelves: true, hoursBeforeInactive: 12 });
    const all = (await harness.behavior.callRpc("resetSettings", {})) as Versioned<typeof DEFAULT_SETTINGS>;
    expect(all.value).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps the record across a server restart", async () => {
    const { harness } = await load();
    await harness.behavior.callRpc("writeSettings", { patch: { hoursBeforeInactive: 24 } });
    const reloaded = await harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    expect((await sync(reloaded.harness)).settings.value.hoursBeforeInactive).toBe(24);
  });
});

describe("project appearance", () => {
  it("sets, resets and forgets a project's colour, publishing the whole map", async () => {
    const { harness } = await load();
    await harness.behavior.callRpc("setProjectColour", { projectId: "p1", colour: "#aabbcc" });
    await harness.behavior.callRpc("setProjectColour", { projectId: "p2", colour: "#112233" });
    expect((await sync(harness)).appearance.value.colours).toEqual({ p1: "#aabbcc", p2: "#112233" });
    await harness.behavior.callRpc("resetProjectColour", { projectId: "p1" });
    await harness.behavior.callRpc("forgetProject", { projectId: "p2" });
    expect((await sync(harness)).appearance.value.colours).toEqual({});
    expect(signalsOn(harness, CHANNELS.appearance)).toHaveLength(4);
  });

  it("refuses a colour that is not #rrggbb", async () => {
    const { harness } = await load();
    await expect(harness.behavior.callRpc("setProjectColour", { projectId: "p1", colour: "red" })).rejects.toThrow();
  });

  it("stores an uploaded icon, serves it from the plugin route and drops it with the project", async () => {
    const { harness } = await load(sdkWith(() => [], () => [], { projects: { get: async () => ({ sources: [] }) } }));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const uploaded = (await harness.behavior.callRpc("uploadProjectIcon", {
      projectId: "p1",
      name: "mark.png",
      mime: "image/png",
      dataBase64: png.toString("base64"),
    })) as Versioned<{ icons: Record<string, { name: string; mime: string }> }>;
    expect(uploaded.value.icons.p1).toMatchObject({ name: "mark.png", mime: "image/png" });
    const response = await harness.behavior.fetchHttp("GET", "/project-icon?project=p1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    await expect(
      harness.behavior.callRpc("uploadProjectIcon", { projectId: "p1", name: "a.txt", mime: "text/plain", dataBase64: Buffer.from("hi").toString("base64") }),
    ).rejects.toThrow(/Use an SVG, PNG, ICO, JPEG, GIF, AVIF or WebP image/);
    await harness.behavior.callRpc("setProjectColour", { projectId: "p1", colour: "#aabbcc" });
    await harness.behavior.callRpc("forgetProject", { projectId: "p1" });
    expect((await sync(harness)).appearance.value).toEqual({ colours: {}, icons: {} });
    expect((await harness.behavior.fetchHttp("GET", "/project-icon?project=p1")).status).toBe(204);
  });

  it("clears an uploaded icon and publishes only when there was one", async () => {
    const { harness } = await load();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString("base64");
    await harness.behavior.callRpc("uploadProjectIcon", { projectId: "p1", name: "a.png", mime: "image/png", dataBase64: png });
    await harness.behavior.callRpc("clearProjectIcon", { projectId: "p1" });
    await harness.behavior.callRpc("clearProjectIcon", { projectId: "p1" });
    expect(signalsOn(harness, CHANNELS.appearance)).toHaveLength(2);
    expect((await sync(harness)).appearance.value.icons).toEqual({});
  });
});

describe("reclaim, archive release and auto-settle over the SDK", () => {
  const stoppable = (stopped: string[], terminals: Record<string, unknown[]> = {}, closed: string[] = []) => ({
    threads: {
      async stop({ threadId }: { threadId: string }) {
        stopped.push(threadId);
      },
    },
    terminals: {
      async list({ scope }: { scope: { threadId: string } }) {
        return { sessions: terminals[scope.threadId] ?? [] };
      },
      async get({ terminalId }: { terminalId: string }) {
        return Object.values(terminals).flat().find((session) => (session as { id: string }).id === terminalId);
      },
      async close({ terminalId, mode }: { terminalId: string; mode: string }) {
        if (mode !== "if-clean") throw new Error("must not force");
        closed.push(terminalId);
      },
    },
  });

  it("stops the runtime and closes the untouched terminal when a thread is snoozed, and reports it for the toast", async () => {
    const stopped: string[] = [];
    const closed: string[] = [];
    const session = (id: string, lastUserInputAt: number | null) => ({ id, status: "running", lastUserInputAt });
    const { harness } = await load(
      sdkWith(() => [listedThread("a")], () => [], stoppable(stopped, { a: [session("idle", null), session("typed", 5)] }, closed)),
    );
    const result = (await harness.behavior.callRpc("snooze", { threadId: "a", until: Date.now() + 3_600_000 })) as { note: string | null };
    expect(stopped).toEqual(["a"]);
    expect(closed).toEqual(["idle"]);
    expect(result.note).toBe("Agent session stopped · closed 1 terminal nobody used · 1 terminal left running");
  });

  it("stops an archived thread's runtime and its idle children's, and leaves a working child alone", async () => {
    const stopped: string[] = [];
    const { harness } = await load(
      sdkWith(
        () => [
          listedThread("idle-kid", { parentThreadId: "root" }),
          listedThread("busy-kid", { parentThreadId: "root", status: "active", runtime: { displayStatus: "active" } }),
        ],
        () => [],
        stoppable(stopped),
      ),
    );
    await harness.behavior.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id: "root", archivedAt: 5 }) });
    expect(stopped.sort()).toEqual(["idle-kid", "root"]);
  });

  it("runs a pass over RPC and on the five-minute schedule, and a pass on a settings change", async () => {
    const now = Date.now();
    const old = (id: string) => listedThread(id, { createdAt: now - 9 * 86_400_000, updatedAt: now - 9 * 86_400_000, latestAttentionAt: now - 9 * 86_400_000 });
    const threads = [old("old")];
    const { harness } = await load(sdkWith(() => threads, () => [], stoppable([])));
    expect(harness.registrations.schedules.map(({ name, cron }) => [name, cron])).toContainEqual(["auto-settle", "*/5 * * * *"]);
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: ["old"], unsettled: [] });
    expect(rowOf(await sync(harness), "old")).toMatchObject({ settledKind: "auto" });

    threads.push(old("older"));
    await harness.behavior.runSchedule("auto-settle");
    expect(rowOf(await sync(harness), "older")).toMatchObject({ settledKind: "auto" });

    threads.push(old("third"));
    await harness.behavior.callRpc("writeSettings", { patch: { daysBeforeAutoSettle: 5 } });
    await vi.waitFor(async () => expect(rowOf(await sync(harness), "third")).toMatchObject({ settledKind: "auto" }));
  });
});

describe("the startup service", () => {
  it("forgets rows of threads bb no longer has, clears stale marks, and lists visible threads in the manual order", async () => {
    const threads = [
      listedThread("kept", { createdAt: 1 }),
      listedThread("newer", { createdAt: 5 }),
      listedThread("helper", { visibility: "hidden", createdAt: 9 }),
      listedThread("stale", { latestAttentionAt: 5_000, createdAt: 2 }),
    ];
    const archived = [listedThread("old", { archivedAt: 100 })];
    const first = await load(sdkWith(() => threads, () => archived));
    // Rows written while the server was not running, as after an offline stretch.
    const lifecycleRows = createLifecycleStore(first.bb.storage.database());
    lifecycleRows.putMany([
      ["gone", parkedRow(1)],
      ["old", parkedRow(1)],
      ["stale", parkedRow(1_000)],
    ]);
    const replacement = await first.harness.lifecycle.reload(plugin);
    hosts.push(replacement);
    const { harness, bb } = replacement;
    const service = harness.behavior.runService("startup");
    await vi.waitFor(async () => expect((await sync(harness)).order.value).toEqual(["newer", "stale", "kept"]));
    service.controller.abort();
    await service.done;
    expect([...createLifecycleStore(bb.storage.database()).all().keys()].sort()).toEqual(["old"]);

    // The archived thread keeps its row but is left out of a full answer, and comes back with its row when unarchived.
    const full = await sync(harness);
    expect(full.full).toBe(true);
    expect(Object.keys(full.records)).toEqual([]);
    const ahead = await sync(harness, { epoch: full.epoch, revision: full.revision + 1 });
    expect(ahead.full).toBe(true);
    expect(Object.keys(ahead.records)).toEqual([]);

    await harness.behavior.emitThreadEvent("thread.unarchived", { thread: makeThreadResponse({ id: "old" }) });
    expect(recordSignals(harness).at(-1)?.records).toEqual({ old: { lifecycle: parkedRow(1) } });
    const back = await sync(harness, { epoch: full.epoch, revision: full.revision });
    expect(back).toMatchObject({ full: false, records: { old: { lifecycle: parkedRow(1) } } });
  });

  it("keeps the row and the order entry of a thread the listing missed but bb still has, and forgets those bb does not", async () => {
    const kept = listedThread("kept", { createdAt: 3 });
    const skipped = listedThread("skipped", { createdAt: 2 });
    const sdk = sdkWith(() => [kept], () => [], {
      threads: {
        async get({ threadId }: { threadId: string }) {
          const thread = [kept, skipped].find((candidate) => candidate.id === threadId);
          if (thread === undefined) throw Object.assign(new Error("Thread not found"), { code: "thread_not_found" });
          return thread;
        },
      },
    });
    const first = await load(sdk);
    createLifecycleStore(first.bb.storage.database()).putMany([
      ["skipped", parkedRow(5_000)],
      ["gone", parkedRow(5_000)],
    ]);
    createOrderStore(first.bb.storage.database()).replace(["skipped", "gone", "kept"]);
    const replacement = await first.harness.lifecycle.reload(plugin);
    hosts.push(replacement);
    const { harness, bb } = replacement;
    const service = harness.behavior.runService("startup");
    service.controller.abort();
    await service.done;
    expect([...createLifecycleStore(bb.storage.database()).all().keys()]).toEqual(["skipped"]);
    expect((await sync(harness)).order.value).toEqual(["skipped", "kept"]);
  });

  it("forgets nothing when bb cannot say whether a thread exists", async () => {
    const sdk = sdkWith(() => [], () => [], {
      threads: {
        async get() {
          throw new Error("bb is restarting");
        },
      },
    });
    const first = await load(sdk);
    createLifecycleStore(first.bb.storage.database()).putMany([["a", parkedRow(5_000)]]);
    createOrderStore(first.bb.storage.database()).replace(["a"]);
    const replacement = await first.harness.lifecycle.reload(plugin);
    hosts.push(replacement);
    const { harness, bb } = replacement;
    const service = harness.behavior.runService("startup");
    service.controller.abort();
    await service.done;
    expect([...createLifecycleStore(bb.storage.database()).all().keys()]).toEqual(["a"]);
    expect((await sync(harness)).order.value).toEqual(["a"]);
  });
});

describe("the earlier list's data", () => {
  async function seedEarlierData(harness: Harness, bb: Awaited<ReturnType<typeof load>>["bb"]) {
    const db = bb.storage.database();
    db.prepare("INSERT OR REPLACE INTO stamps (thread_id, seen_at) VALUES ('a', 1)").run();
    db.prepare("INSERT OR REPLACE INTO notes (thread_id, data) VALUES ('a', '{}')").run();
    await bb.storage.kv.set("preference:organizationMode", "machine");
    await bb.storage.kv.set("stamp:a", {});
    await bb.storage.kv.set("note:a", {});
    void harness;
  }

  async function start(harness: Harness) {
    const service = harness.behavior.runService("startup");
    service.controller.abort();
    await service.done;
  }

  it("is removed on the first start, and the shelf list's own data is kept through it and every later start", async () => {
    const { harness, bb } = await load(sdkWith(() => [listedThread("a"), listedThread("b")]));
    await harness.behavior.callRpc("writeSettings", { patch: { workingShelf: true } });
    await harness.behavior.callRpc("park", { threadId: "a" });
    await harness.behavior.callRpc("setProjectColour", { projectId: "p1", colour: "#aabbcc" });
    for (const id of ["a", "b"]) await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id }) });
    await seedEarlierData(harness, bb);

    await start(harness);
    const db = bb.storage.database();
    // The earlier design's tables stay, empty, so going back to it on this database keeps working.
    expect(db.prepare("SELECT thread_id FROM stamps").all()).toEqual([]);
    expect(db.prepare("SELECT thread_id FROM notes").all()).toEqual([]);
    expect(() => db.prepare("INSERT INTO stamps (thread_id, seen_at) VALUES ('b', 2)").run()).not.toThrow();
    expect(await bb.storage.kv.list("preference:")).toEqual([]);
    expect(await bb.storage.kv.list("stamp:")).toEqual([]);
    expect(await bb.storage.kv.list("note:")).toEqual([]);

    const reloaded = await harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    await start(reloaded.harness);
    const answer = await sync(reloaded.harness);
    expect(answer.settings.value.workingShelf).toBe(true);
    expect(answer.records.a?.lifecycle).toEqual(expect.objectContaining({ parkedAt: expect.any(Number) }));
    expect(answer.appearance.value.colours).toEqual({ p1: "#aabbcc" });
    expect(answer.order.value).toEqual(["b", "a"]);
  });

  it("starts without them on an install that never held them", async () => {
    const { harness, bb } = await load();
    await start(harness);
    await start(harness);
    expect(await bb.storage.kv.list()).toEqual([]);
    expect((await sync(harness)).settings.value).toEqual(DEFAULT_SETTINGS);
  });
});
