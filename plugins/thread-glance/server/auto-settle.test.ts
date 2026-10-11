import { describe, expect, it } from "vitest";
import { activeRow, parkedRow, settledRow, snoozedRow, type LifecycleRow } from "../shared/lifecycle";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import type { ChangeRecords } from "./actions";
import { createAutoSettle } from "./auto-settle";
import { createLifecycleStore } from "./lifecycle-store";
import type { PullRequestStatus } from "./pull-requests";
import type { ReclaimTarget } from "./reclaim";
import { createSerialQueue } from "./serial";
import { createFakePullRequests, createFakeThreads, makeServerThread, memoryDatabase, pinned } from "./testing/fakes";
import type { ServerThread } from "./threads";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 100 * DAY;

/** A thread whose last activity was `days` days before NOW. */
const idleFor = (id: string, days: number, overrides: Partial<ServerThread> = {}) =>
  makeServerThread(id, {
    createdAt: NOW - days * DAY,
    updatedAt: NOW - days * DAY,
    latestAttentionAt: NOW - days * DAY,
    ...overrides,
  });

const prAt = (state: "closed" | "draft" | "merged" | "open", ageDays: number): PullRequestStatus => ({
  kind: "available",
  state,
  updatedAt: NOW - ageDays * DAY,
});

function setup(threadList: ServerThread[], options: { rows?: [string, LifecycleRow][]; settings?: Partial<Settings>; pullRequests?: Record<string, PullRequestStatus> } = {}) {
  const lifecycle = createLifecycleStore(memoryDatabase());
  lifecycle.putMany(options.rows ?? []);
  const threads = createFakeThreads(threadList);
  const pullRequests = createFakePullRequests(options.pullRequests);
  let settings: Settings = { ...DEFAULT_SETTINGS, ...options.settings };
  const reclaimed: ReclaimTarget[][] = [];
  const published: string[][] = [];
  const inOrder = createSerialQueue();
  const change: ChangeRecords = (write) =>
    inOrder(async () => {
      const touched = new Set<string>();
      try {
        return await write((ids) => {
          for (const id of ids) touched.add(id);
        });
      } finally {
        published.push([...touched]);
      }
    });
  const autoSettle = createAutoSettle({
    lifecycle,
    threads,
    pullRequests,
    settings: { read: async () => settings },
    reclaim: async (targets) => {
      reclaimed.push([...targets]);
      return { stoppedRuntime: true, closedTerminals: 0, keptTerminals: 0 };
    },
    change,
    now: () => NOW,
  });
  return {
    lifecycle,
    threads,
    pullRequests,
    autoSettle,
    reclaimed,
    published,
    setSettings: (next: Partial<Settings>) => (settings = { ...settings, ...next }),
  };
}

const withEnvironment = (thread: ServerThread, environmentId = `env-${thread.id}`): ServerThread => ({ ...thread, environmentId });

describe("auto-settle examples (AC11)", () => {
  it("settles a thread idle 4 days with the default settings and no pull request, without a toast", async () => {
    const { autoSettle, lifecycle, reclaimed } = setup([idleFor("a", 4)]);
    expect(await autoSettle.run()).toEqual({ settled: ["a"], unsettled: [] });
    expect(lifecycle.get("a")).toEqual(settledRow(NOW, "auto"));
    // It reclaims, and the result carries no note for a toast.
    expect(reclaimed).toEqual([[{ threadId: "a", row: settledRow(NOW, "auto") }]]);
  });

  it("keeps a thread idle 4 days whose pull request is open", async () => {
    const { autoSettle, lifecycle } = setup([withEnvironment(idleFor("a", 4), "env")], { pullRequests: { env: prAt("open", 5) } });
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
    expect(lifecycle.get("a")).toBeNull();
  });

  it("keeps a thread whose pull request is a draft", async () => {
    const { autoSettle } = setup([withEnvironment(idleFor("a", 4), "env")], { pullRequests: { env: prAt("draft", 5) } });
    expect((await autoSettle.run()).settled).toEqual([]);
  });

  it("does not settle on a merge after the thread's last activity when Settle merged pull requests is off", async () => {
    const { autoSettle } = setup([withEnvironment(idleFor("a", 1), "env")], {
      settings: { settleMergedPullRequests: false },
      pullRequests: { env: prAt("merged", 0.5) },
    });
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
  });

  it("settles on that merge when the setting is on, even for a thread quiet less than the days", async () => {
    const { autoSettle } = setup([withEnvironment(idleFor("a", 1), "env")], { pullRequests: { env: prAt("merged", 0.5) } });
    expect((await autoSettle.run()).settled).toEqual(["a"]);
  });

  it("leaves the shelf alone when bb cannot read the pull request, including an automatic settle already made", async () => {
    const unreadable: PullRequestStatus = { kind: "unknown" };
    const { autoSettle, lifecycle } = setup([withEnvironment(idleFor("a", 4), "env"), withEnvironment(idleFor("b", 4), "env-b")], {
      rows: [["b", settledRow(NOW - DAY, "auto")]],
      pullRequests: { env: unreadable, "env-b": unreadable },
    });
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
    expect(lifecycle.get("a")).toBeNull();
    expect(lifecycle.get("b")).toEqual(settledRow(NOW - DAY, "auto"));
  });
});

describe("what a pass decides", () => {
  it("settles a closed pull request only if it changed after the thread's last activity", async () => {
    const { autoSettle } = setup(
      [withEnvironment(idleFor("after", 1), "env-after"), withEnvironment(idleFor("before", 1), "env-before")],
      { pullRequests: { "env-after": prAt("closed", 0.5), "env-before": prAt("closed", 2) } },
    );
    expect((await autoSettle.run()).settled).toEqual(["after"]);
  });

  it("does not settle quiet threads when the setting is off, but still settles a closed pull request", async () => {
    const { autoSettle } = setup([idleFor("quiet", 9), withEnvironment(idleFor("closed", 1), "env")], {
      settings: { settleQuietThreads: false },
      pullRequests: { env: prAt("closed", 0.5) },
    });
    expect((await autoSettle.run()).settled).toEqual(["closed"]);
  });

  it("settles a quiet thread only after more than the days set", async () => {
    const { autoSettle } = setup([idleFor("two", 2), idleFor("three", 3), idleFor("four", 4)], { settings: { daysBeforeAutoSettle: 3 } });
    expect((await autoSettle.run()).settled).toEqual(["four"]);
  });

  it("leaves a thread with a manual mark alone, and a thread already on the automatic rules unchanged", async () => {
    const { autoSettle, lifecycle } = setup([idleFor("manual", 9), idleFor("override", 9)], {
      rows: [
        ["manual", settledRow(NOW - 5 * DAY, "manual")],
        ["override", activeRow()],
      ],
    });
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
    expect(lifecycle.get("override")).toEqual(activeRow());
  });

  it("never settles a pinned, busy, parked or snoozed thread", async () => {
    const { autoSettle } = setup(
      [
        pinned(idleFor("pinned", 9)),
        idleFor("busy", 9, { status: "active" }),
        idleFor("monitor", 9, { runtimeStatus: "active" }),
        idleFor("asking", 9, { hasPendingInteraction: true }),
        idleFor("parked", 9),
        idleFor("snoozed", 9),
      ],
      {
        rows: [
          ["parked", parkedRow(NOW - 8 * DAY)],
          ["snoozed", snoozedRow(NOW + DAY, NOW - 8 * DAY)],
        ],
      },
    );
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
  });

  it("returns an automatic settle to the automatic rules when the thread is pinned, busy or parked, and not a manual one", async () => {
    const auto = settledRow(NOW - DAY, "auto");
    const { autoSettle, lifecycle } = setup(
      [pinned(idleFor("pinned", 9)), idleFor("busy", 9, { status: "active" }), idleFor("kept", 9), idleFor("manual", 9, { status: "active" })],
      { rows: [["pinned", auto], ["busy", auto], ["kept", auto], ["manual", settledRow(NOW - DAY, "manual")]] },
    );
    const result = await autoSettle.run();
    expect(result.unsettled.sort()).toEqual(["busy", "pinned"]);
    expect(lifecycle.get("pinned")).toBeNull();
    expect(lifecycle.get("kept")).toEqual(auto);
    expect(lifecycle.get("manual")).toEqual(settledRow(NOW - DAY, "manual"));
  });

  it("returns an automatic settle when the pull request turns out to be open", async () => {
    const { autoSettle, lifecycle } = setup([withEnvironment(idleFor("a", 9), "env")], {
      rows: [["a", settledRow(NOW - DAY, "auto")]],
      pullRequests: { env: prAt("open", 1) },
    });
    expect((await autoSettle.run()).unsettled).toEqual(["a"]);
    expect(lifecycle.get("a")).toBeNull();
  });

  it("skips hidden threads", async () => {
    const { autoSettle } = setup([idleFor("helper", 9, { hidden: true }), idleFor("visible", 9)]);
    expect((await autoSettle.run()).settled).toEqual(["visible"]);
  });

  it("asks bb once for each environment, and only for threads it could settle", async () => {
    const { autoSettle, pullRequests } = setup([
      withEnvironment(idleFor("a", 9), "shared"),
      withEnvironment(idleFor("b", 9), "shared"),
      withEnvironment(pinned(idleFor("c", 9)), "pinned-env"),
      withEnvironment(idleFor("d", 9, { status: "active" }), "busy-env"),
    ]);
    await autoSettle.run();
    expect(pullRequests.reads).toEqual(["shared"]);
  });

  it("publishes the records it changed in one change", async () => {
    const { autoSettle, published } = setup([idleFor("a", 9), idleFor("b", 9), idleFor("c", 1)]);
    await autoSettle.run();
    expect(published).toEqual([["a", "b"]]);
  });
});

describe("trees", () => {
  const tree = (childOverrides: Partial<ServerThread> = {}, parentDays = 9) => [
    idleFor("parent", parentDays),
    idleFor("child", 9, { parentThreadId: "parent", ...childOverrides }),
  ];

  it("settles a parent together with its quiet children", async () => {
    const { autoSettle } = setup(tree());
    expect((await autoSettle.run()).settled.sort()).toEqual(["child", "parent"]);
  });

  it("does not settle a parent while a child is not settled or settling", async () => {
    const { autoSettle } = setup(tree({ createdAt: NOW - DAY, updatedAt: NOW - DAY, latestAttentionAt: NOW - DAY }));
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
  });

  it("does not settle a parent over a working child, and settles the child's own quiet subtree", async () => {
    const { autoSettle } = setup([...tree({ status: "active" }), idleFor("grandchild", 9, { parentThreadId: "child" })]);
    expect((await autoSettle.run()).settled).toEqual(["grandchild"]);
  });

  it("counts a child settled by hand as settled", async () => {
    const { autoSettle } = setup(tree(), { rows: [["child", settledRow(NOW - DAY, "manual")]] });
    expect((await autoSettle.run()).settled).toEqual(["parent"]);
  });

  it("withdraws a grandparent too when its descendant cannot settle", async () => {
    const { autoSettle } = setup([
      idleFor("grandparent", 9),
      idleFor("parent", 9, { parentThreadId: "grandparent" }),
      idleFor("child", 1, { parentThreadId: "parent" }),
    ]);
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
  });

  it("returns an automatic settle of a parent whose child came back", async () => {
    const auto = settledRow(NOW - 2 * DAY, "auto");
    const { autoSettle, lifecycle } = setup(tree({ createdAt: NOW - DAY, updatedAt: NOW - DAY, latestAttentionAt: NOW - DAY }), {
      rows: [["parent", auto]],
    });
    expect((await autoSettle.run()).unsettled).toEqual(["parent"]);
    expect(lifecycle.get("parent")).toBeNull();
  });

  it("ignores hidden helpers below a parent", async () => {
    const { autoSettle } = setup([idleFor("parent", 9), idleFor("helper", 0, { parentThreadId: "parent", hidden: true })]);
    expect((await autoSettle.run()).settled).toEqual(["parent"]);
  });
});

describe("one pass at a time", () => {
  /** A bb whose thread listing waits until the test lets it through. */
  function gated(threadList: ServerThread[]) {
    const fixture = setup(threadList);
    const gates: (() => void)[] = [];
    const read = fixture.threads.snapshot.bind(fixture.threads);
    let started = 0;
    fixture.threads.snapshot = async () => {
      started += 1;
      await new Promise<void>((resolve) => gates.push(resolve));
      return read();
    };
    return { ...fixture, gates, started: () => started };
  }
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  it("runs one pass and queues one more, which callers made meanwhile share", async () => {
    const { autoSettle, gates, started } = gated([idleFor("a", 9)]);
    const first = autoSettle.run();
    const second = autoSettle.run();
    const third = autoSettle.run();
    await flush();
    expect(started()).toBe(1);
    // The first pass reads the listing twice: once to find pull requests, once to write.
    gates.shift()!();
    await flush();
    gates.shift()!();
    expect(await first).toEqual({ settled: ["a"], unsettled: [] });
    await flush();
    // The queued pass starts only after the first ends, and answers both callers that waited.
    expect(started()).toBe(3);
    while (gates.length > 0) gates.shift()!();
    await flush();
    gates.shift()?.();
    const [afterSecond, afterThird] = await Promise.all([second, third]);
    expect(afterThird).toBe(afterSecond);
    expect(started()).toBe(4);
  });

  it("throws away a pass that started under older settings, and the settings change runs a new one", async () => {
    const { autoSettle, gates, lifecycle, setSettings, started } = gated([idleFor("a", 4)]);
    const stale = autoSettle.run();
    await flush();
    expect(started()).toBe(1);
    setSettings({ daysBeforeAutoSettle: 10 });
    autoSettle.onSettingsChanged(["daysBeforeAutoSettle"]);
    gates.shift()!();
    await flush();
    gates.shift()?.();
    expect(await stale).toEqual({ settled: [], unsettled: [] });
    expect(lifecycle.get("a")).toBeNull();
    // The queued pass, under the new settings, does not settle a thread idle 4 days either.
    await flush();
    for (let i = 0; i < 4; i += 1) {
      gates.shift()?.();
      await flush();
    }
    // A discarded pass reads the listing once; the new pass reads it twice.
    expect(started()).toBe(3);
    expect(lifecycle.get("a")).toBeNull();
  });

  it("starts a pass for a change to an auto-settle setting and for no other", async () => {
    const { autoSettle, threads, lifecycle } = setup([idleFor("a", 9)]);
    autoSettle.onSettingsChanged(["compactWorkingThreads"]);
    await Promise.resolve();
    expect(threads.snapshots).toBe(0);
    autoSettle.onSettingsChanged(["settleQuietThreads"]);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    expect(lifecycle.get("a")).toEqual(settledRow(NOW, "auto"));
  });

  it("decides again from bb's data at the moment it writes, so a pin made while it waited is respected", async () => {
    const { autoSettle, threads, lifecycle } = setup([idleFor("a", 9)]);
    threads.beforeSnapshot = (call) => {
      if (call === 2) threads.threads.set("a", pinned(idleFor("a", 9)));
    };
    expect(await autoSettle.run()).toEqual({ settled: [], unsettled: [] });
    expect(lifecycle.get("a")).toBeNull();
  });
});
