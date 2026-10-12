// The ledger the Fleet tab opens (AC12).
import { describe, expect, it } from "vitest";
import type { LedgerRow } from "./ports";
import { args, manifest, MANAGER, MANIFEST_PATH, REPO_KEY, world, type World } from "../testing/kit";
import { createDashboard, LEDGER_LIMIT } from "./dashboard";
import { registerFleet } from "./register";

const REPO = "github.com/org/repo";

const start = async (w: World) => {
  w.manifests.files.set(MANIFEST_PATH, manifest());
  await registerFleet(w.register, MANAGER, args());
};

let count = 0;
const record = (w: World, over: Partial<Omit<LedgerRow, "wakeId">> = {}) => {
  count += 1;
  w.store.recordChange(REPO_KEY, {
    key: `k${count}`,
    role: "forge",
    ref: "#1",
    url: "https://github.com/org/repo/issues/1",
    kind: "commented",
    label: null,
    actor: "alice",
    at: "2026-10-12T09:00:00.000Z",
    seenAt: `2026-10-12T09:${String(count % 60).padStart(2, "0")}:00.000Z`,
    disposition: "wake",
    rule: null,
    ...over,
  });
};

const ledgerOf = async (w: World, filter?: Parameters<ReturnType<typeof createDashboard>["ledger"]>[0]["filter"]) => {
  const answer = await createDashboard(w.dash).ledger({ repo: REPO, ...(filter === undefined ? {} : { filter }) });
  if (!answer.ok) throw new Error(answer.reason);
  return answer.ledger;
};

describe("ledger", () => {
  it("refuses a repository no fleet holds", async () => {
    expect(await createDashboard(world().dash).ledger({ repo: REPO })).toEqual({ ok: false, reason: `no fleet is registered for ${REPO}` });
  });

  it("lists, under All, the changes that were not dropped: woke, held and failed read", async () => {
    const w = world();
    await start(w);
    record(w, { kind: "labelled", label: "status:ready", disposition: "wake" });
    record(w, { kind: "merged", disposition: "echo", rule: "marker", actor: null });
    record(w, { disposition: "out-of-scope", kind: "updated", ref: "#99" });
    record(w, { disposition: "held", rule: "no manager" });
    w.store.recordFailedRead(REPO_KEY, { at: "2026-10-12T09:59:00.000Z", role: "forge", ref: "#2", reason: "HTTP 500 from GET /repos/org/repo/issues/2" });
    const { changes } = await ledgerOf(w);
    expect(changes.map((change) => change.done)).toEqual(["failed read", "held", "woke"]);
    expect(changes[2]).toMatchObject({ ref: "#1", url: "https://github.com/org/repo/issues/1", kind: "labelled status:ready", actor: "alice", rule: null });
    expect(changes[0]).toMatchObject({ ref: "#2", kind: "failed read of the forge", rule: "HTTP 500 from GET /repos/org/repo/issues/2" });
  });

  it("lists the dropped changes with their reasons when the filter asks for them", async () => {
    const w = world();
    await start(w);
    record(w, { kind: "merged", disposition: "echo", rule: "marker", actor: null });
    record(w, { disposition: "out-of-scope", kind: "updated", ref: "#99" });
    expect((await ledgerOf(w, { done: "echo" })).changes).toMatchObject([{ done: "echo", kind: "merged", actor: null, rule: "marker" }]);
    expect((await ledgerOf(w, { done: "out-of-scope" })).changes).toMatchObject([{ done: "out-of-scope", ref: "#99" }]);
  });

  it("keeps the woken changes in the list however many dropped ones are newer than the limit", async () => {
    const w = world();
    await start(w);
    record(w, { ref: "#1", disposition: "wake", seenAt: "2026-10-12T08:00:00.000Z" });
    record(w, { ref: "#2", disposition: "held", rule: "no manager", seenAt: "2026-10-12T08:01:00.000Z" });
    for (let n = 0; n < 12; n += 1) record(w, { disposition: n % 2 === 0 ? "echo" : "out-of-scope", rule: n % 2 === 0 ? "marker" : null, seenAt: `2026-10-12T09:${String(10 + n)}:00.000Z` });
    const all = await ledgerOf(w, { limit: 5 });
    expect(all.changes.map((change) => [change.ref, change.done])).toEqual([["#2", "held"], ["#1", "woke"]]);
    expect(all.dropped.map((group) => [group.reason, group.count])).toEqual([["echo: marker", 6], ["out of scope", 6]]);
  });

  it("cuts the list to the limit among the changes that were not dropped", async () => {
    const w = world();
    await start(w);
    for (let n = 0; n < 8; n += 1) record(w, { ref: `#${n + 1}`, disposition: "wake", seenAt: `2026-10-12T08:0${n}:00.000Z` });
    for (let n = 0; n < 8; n += 1) record(w, { disposition: "echo", rule: "label", seenAt: `2026-10-12T09:0${n}:00.000Z` });
    const { changes, dropped } = await ledgerOf(w, { limit: 3 });
    expect(changes.map((change) => change.ref)).toEqual(["#8", "#7", "#6"]);
    expect(dropped[0]).toMatchObject({ reason: "echo: label", count: 8 });
  });

  it("filters by item and by what was done", async () => {
    const w = world();
    await start(w);
    record(w, { ref: "#1", disposition: "wake" });
    record(w, { ref: "#2", url: "https://github.com/org/repo/issues/2", disposition: "echo", rule: "label" });
    record(w, { ref: "#2", url: "https://github.com/org/repo/issues/2", disposition: "wake" });
    expect((await ledgerOf(w, { item: "#2" })).changes).toHaveLength(1);
    expect((await ledgerOf(w, { item: "#2" })).dropped).toMatchObject([{ reason: "echo: label", count: 1 }]);
    expect((await ledgerOf(w, { done: "echo" })).changes.map((change) => change.ref)).toEqual(["#2"]);
    expect((await ledgerOf(w, { item: "#2", done: "woke" })).changes).toHaveLength(1);
    expect((await ledgerOf(w, { item: "#7" })).changes).toEqual([]);
  });

  it("groups dropped changes by reason with a count each, the largest group first (AC12)", async () => {
    const w = world();
    await start(w);
    for (let n = 0; n < 3; n += 1) record(w, { disposition: "echo", rule: "marker" });
    record(w, { disposition: "echo", rule: "echo actor" });
    for (let n = 0; n < 2; n += 1) record(w, { disposition: "out-of-scope", kind: "updated" });
    record(w, { disposition: "wake" });
    const { dropped } = await ledgerOf(w);
    expect(dropped.map((group) => [group.reason, group.count, group.changes.length])).toEqual([
      ["echo: marker", 3, 3],
      ["out of scope", 2, 2],
      ["echo: echo actor", 1, 1],
    ]);
  });

  it("groups only what the filter lets through, and counts past the number of changes it lists", async () => {
    const w = world();
    await start(w);
    for (let n = 0; n < 40; n += 1) record(w, { disposition: "echo", rule: "marker" });
    for (let n = 0; n < 7; n += 1) record(w, { disposition: "wake" });
    expect((await ledgerOf(w, { done: "woke" })).dropped).toEqual([]);
    const all = await ledgerOf(w, { limit: 5 });
    expect(all.changes).toHaveLength(5);
    expect(all.dropped[0]).toMatchObject({ reason: "echo: marker", count: 40 });
    expect(all.dropped[0]!.changes.length).toBeLessThan(40);
  });

  it("lists the wakes", async () => {
    const w = world();
    await start(w);
    w.store.createWake(REPO_KEY, { kind: "changes", threadId: MANAGER, queuedMessageId: "m1", queuedAt: "2026-10-12T09:00:00.000Z", since: "2026-10-12T08:00:00.000Z", catchUpMs: null, heldSince: null, notWatched: null });
    w.store.markDispatched("m1", "2026-10-12T09:05:00.000Z");
    expect((await ledgerOf(w)).wakes).toEqual([{ queuedAt: "2026-10-12T09:00:00.000Z", dispatchedAt: "2026-10-12T09:05:00.000Z", kind: "changes" }]);
  });

  it("caps the changes at 250 and bounds every string", async () => {
    const w = world();
    await start(w);
    for (let n = 0; n < LEDGER_LIMIT + 20; n += 1) record(w, { url: `https://github.com/org/repo/issues/${"9".repeat(500)}`, actor: "a".repeat(500) });
    const { changes } = await ledgerOf(w, { limit: 10_000 });
    expect(changes).toHaveLength(LEDGER_LIMIT);
    expect(changes[0]!.url.length).toBeLessThanOrEqual(200);
    expect(changes[0]!.actor!.length).toBeLessThanOrEqual(200);
    const widest = JSON.stringify(await ledgerOf(w, { limit: 10_000 }));
    expect(widest.length).toBeLessThan(1024 * 1024);
  });

  it("answers for a fleet whose history holds nothing", async () => {
    const w = world();
    await start(w);
    expect(await ledgerOf(w)).toMatchObject({ changes: [], dropped: [], wakes: [] });
  });
});
