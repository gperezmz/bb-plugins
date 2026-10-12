import { describe, expect, it } from "vitest";
import { args, manifest, MANAGER, MANIFEST_PATH, outcome, REPO_KEY, TOKEN, world, type World } from "../testing/kit";
import { pollFleet } from "./poll";
import { registerFleet } from "./register";
import { pollDue, refreshFleetsOf, setFleetInterval } from "./schedule";
import { SerialQueue } from "./serial";

const OTHER_REPO = "github.com/org/other";
const OTHER_MANIFEST = "/work/other/manifest.md";

const startBoth = async (w: World) => {
  w.manifests.files.set(MANIFEST_PATH, manifest());
  w.manifests.files.set(OTHER_MANIFEST, manifest());
  w.threads.states.set("thr_other", "live");
  await registerFleet(w.register, MANAGER, args());
  await registerFleet(w.register, "thr_other", args({ repo: OTHER_REPO, manifest: OTHER_MANIFEST }));
};

describe("refreshing the fleets of a manager whose turn ended", () => {
  it("reads the state of the fleets that thread holds and no others, and wakes nobody", async () => {
    const w = world();
    await startBoth(w);
    await refreshFleetsOf(w.poll, new SerialQueue(), MANAGER);
    expect(w.adapters.github.reads).toHaveLength(0);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: ["| #7 | A parked question | answer | 2026-10-12T09:00:00Z | https://github.com/org/repo/issues/7 |"] }));
    await refreshFleetsOf(w.poll, new SerialQueue(), MANAGER);
    expect(w.adapters.github.reads.map((read) => [read.stateOnly, read.items.map((item) => item.ref)])).toEqual([[true, ["#7"]]]);
    expect(w.channel.sent).toEqual([]);
  });

  it("runs behind a poll of the same fleet", async () => {
    const w = world();
    await startBoth(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: ["| #7 | A parked question | answer | 2026-10-12T09:00:00Z | https://github.com/org/repo/issues/7 |"] }));
    const queue = new SerialQueue();
    let release!: () => void;
    const log: string[] = [];
    w.adapters.github.queue(async () => {
      log.push("poll reads");
      await new Promise<void>((resolve) => (release = resolve));
      log.push("poll ends");
      return outcome();
    });
    w.adapters.github.queue(() => {
      log.push("refresh reads");
      return outcome();
    });
    const polling = queue.run(REPO_KEY, () => pollFleet(w.poll, REPO_KEY));
    await Promise.resolve();
    const refreshing = refreshFleetsOf(w.poll, queue, MANAGER);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual(["poll reads"]);
    release();
    await Promise.all([polling, refreshing]);
    expect(log).toEqual(["poll reads", "poll ends", "refresh reads"]);
  });

  it("warns, without a token, when a read fails, and refreshes the thread's other fleets", async () => {
    const w = world();
    await startBoth(w);
    await registerFleet(w.register, MANAGER, args({ repo: "github.com/org/third", manifest: "/work/third/manifest.md" }));
    w.manifests.files.set("/work/third/manifest.md", manifest({ inbox: ["| #7 | A parked question | answer | 2026-10-12T09:00:00Z | https://github.com/org/third/issues/7 |"] }));
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: ["| #7 | A parked question | answer | 2026-10-12T09:00:00Z | https://github.com/org/repo/issues/7 |"] }));
    w.store.setIntervalMs(REPO_KEY, 30_000);
    const original = w.store.getCursor.bind(w.store);
    w.store.getCursor = (repo, role) => {
      if (repo === REPO_KEY) throw new Error(`the store failed with ${TOKEN}`);
      return original(repo, role);
    };
    await expect(refreshFleetsOf(w.poll, new SerialQueue(), MANAGER)).resolves.toBeUndefined();
    expect(w.warnings).toHaveLength(1);
    expect(w.warnings[0]).toContain(`reading ${REPO_KEY} after a turn failed`);
    expect(w.warnings[0]).not.toContain(TOKEN);
    expect(w.adapters.github.reads).toHaveLength(1);
  });
});

describe("polling the fleets that are due", () => {
  const blocked = (w: World) => {
    let release!: () => void;
    const log: string[] = [];
    w.adapters.github.queue(async () => {
      log.push("slow fleet reads");
      await new Promise<void>((resolve) => (release = resolve));
      return outcome();
    });
    return { log, release: () => release() };
  };

  it("starts a poll for every due fleet before it returns, and settles when they have", async () => {
    const w = world();
    await startBoth(w);
    const queue = new SerialQueue();
    const polling = pollDue(w.poll, queue);
    expect(queue.busy(REPO_KEY)).toBe(true);
    expect(queue.busy("github.com/org/other")).toBe(true);
    await polling;
    expect(w.adapters.github.reads).toHaveLength(2);
    expect(queue.busy(REPO_KEY)).toBe(false);
  });

  it("does not start a fleet whose poll is still running, and does not wait for it", async () => {
    const w = world();
    await startBoth(w);
    const slow = blocked(w);
    const queue = new SerialQueue();
    const first = pollDue(w.poll, queue);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(w.adapters.github.reads).toHaveLength(2);
    expect(slow.log).toEqual(["slow fleet reads"]);

    w.clock.advance(125_000);
    await pollDue(w.poll, queue);
    // The fast fleet was polled again; the slow one, still running, was left alone.
    expect(w.adapters.github.reads).toHaveLength(3);
    expect(slow.log).toEqual(["slow fleet reads"]);

    slow.release();
    await first;
    w.clock.advance(125_000);
    await pollDue(w.poll, queue);
    expect(w.adapters.github.reads).toHaveLength(5);
  });

  it("warns, without a token, of a poll that fails, and goes on", async () => {
    const w = world();
    await startBoth(w);
    w.store.getCursor = () => {
      throw new Error(`the store failed with ${TOKEN}`);
    };
    await expect(pollDue(w.poll, new SerialQueue())).resolves.toBeUndefined();
    expect(w.warnings).toHaveLength(2);
    expect(w.warnings.join("\n")).not.toContain(TOKEN);
  });
});

describe("setting a fleet's interval", () => {
  it("sets it, and sets it back to the default with null", async () => {
    const w = world();
    await startBoth(w);
    expect(setFleetInterval(w.poll, REPO_KEY, 45_000)).toBe(true);
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBe(45_000);
    expect(setFleetInterval(w.poll, REPO_KEY, null)).toBe(true);
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBeNull();
  });

  it("says no and sets nothing when no fleet holds the repository", () => {
    const w = world();
    expect(setFleetInterval(w.poll, REPO_KEY, 45_000)).toBe(false);
    expect(w.store.getFleet(REPO_KEY)).toBeNull();
  });
});
