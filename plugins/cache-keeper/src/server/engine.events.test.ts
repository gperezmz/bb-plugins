/**
 * The engine on bb's events: what a missed event costs, what a restart
 * reads, and what never walks every thread.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { COMPACT_MESSAGE, sentKind } from "../core/messages";
import { RECONCILE_MS } from "./engine";
import { busy, FakeBb, MIN, queued, S, T0 } from "./fake-bb.test.helpers";

let h: FakeBb;
beforeEach(() => {
  h = new FakeBb();
});

const CORRECTED_BY = 5 * MIN + 30 * S;

describe("the reconciliation check", () => {
  it("runs every 5 minutes, give or take 30 seconds, with one listing", async () => {
    h.thread({ id: "t" });
    await h.start();
    const lists = h.calls.list;
    const first = h.engine.dueAt("reconcile")!;
    expect(Math.abs(first - T0 - RECONCILE_MS)).toBeLessThanOrEqual(30 * S);
    await h.advance(first);
    expect(h.calls.list).toBe(lists + 1);
    const second = h.engine.dueAt("reconcile")!;
    expect(Math.abs(second - first - RECONCILE_MS)).toBeLessThanOrEqual(30 * S);
  });

  it("corrects a missed thread.idle: the turn is read and the compaction goes", async () => {
    h.thread({ id: "t", status: "active" });
    h.transcript("t", T0, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("t", true);
    // The turn ends at 1 min with no event; its deadline is at 60.
    h.now = T0 + MIN;
    h.turn("t", h.now, [], "Done.");
    h.patch("t", { status: "idle" });
    await h.advance(T0 + MIN + CORRECTED_BY, false);
    expect((await h.engine.viewOf("t"))?.status).toBe("idle");
    await h.advance(T0 + 62 * MIN, false);
    expect(h.sent.map((s) => s.text)).toEqual([COMPACT_MESSAGE]);
  });

  it("corrects a missed thread.archived and thread.deleted", async () => {
    h.thread({ id: "a", activity: busy });
    h.thread({ id: "d", activity: busy });
    h.transcript("a", T0, 100_000);
    h.transcript("d", T0, 100_000);
    await h.start();
    await h.engine.setCompact("a", true);
    await h.engine.setCompact("d", true);
    h.patch("a", { archivedAt: T0 + S });
    h.patch("d", { deletedAt: T0 + S });
    await h.advance(T0 + CORRECTED_BY, false);
    expect(h.store.get("a").compactOn).toBe(true);
    expect(h.store.turnLog("a")).toBeNull();
    expect(h.store.has("d")).toBe(false);
    expect(h.engine.switchedOn().map((v) => v.threadId)).toEqual([]);
    await h.advance(T0 + 70 * MIN, false);
    expect(h.sent).toEqual([]);
  });

  it("corrects a missed interaction.pending: nothing goes to a thread waiting on your answer", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0 + 4 * MIN, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("t", true);
    h.patch("t", { hasPendingInteraction: true });
    await h.advance(T0 + 4 * MIN + CORRECTED_BY, false);
    expect((await h.engine.viewOf("t"))?.hasPendingInteraction).toBe(true);
    await h.advance(T0 + 70 * MIN, false);
    expect(h.sent).toEqual([]);
  });

  it("corrects a missed message.queued, and a queued row that fires no event at all", async () => {
    h.thread({ id: "q" });
    h.thread({ id: "silent" });
    for (const id of ["q", "silent"]) h.transcript(id, T0 + 10 * MIN, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("q", true);
    await h.engine.setCompact("silent", true);
    h.side("q").queued = [queued({ id: "row", createdAt: T0 + S })];
    h.patch("q", { queuedWork: "waiting" });
    // A steered report bb queues without announcing it.
    h.side("silent").queued = [queued({ id: "steer", createdAt: T0 + S, initiator: "system" })];
    h.patch("silent", { queuedWork: "waiting" });
    await h.advance(T0 + CORRECTED_BY, false);
    expect((await h.engine.viewOf("q"))?.waiting).toBe(true);
    expect((await h.engine.viewOf("silent"))?.waiting).toBe(true);
    h.keepWarm = "never";
    await h.advance(T0 + 75 * MIN, false);
    expect(h.sent).toEqual([]);
  });
});

describe("bb's events", () => {
  it("never lists bb's threads when a thread goes idle or fails", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 300_000);
    await h.start();
    await h.engine.setCompact("t", true);
    const lists = h.calls.list;
    await h.typed("t", "carry on");
    await h.ranTurn("t", [], "It broke.", { status: "failed" });
    expect(h.calls.list).toBe(lists);
  });

  it("takes a turn ending in failure as a turn end: the stretch starts and the compaction goes", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 300_000, "5m");
    await h.start();
    await h.engine.setCompact("t", true);
    h.now = T0 + 10 * MIN;
    await h.ranTurn("t", [], "Overloaded.", { status: "failed" });
    // bb lists a failed thread as error; its next turn is still sent to.
    h.patch("t", { status: "idle" });
    h.emit("idle", "t");
    await h.settle();
    await h.advance(T0 + 10 * MIN + 5 * MIN, false);
    expect(h.sent.map((s) => sentKind(s.text))).toEqual(["compact"]);
  });

  it("fires within a second of the earliest due time, and not in between", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    expect(h.engine.dueAt("tree:t")).toBe(T0 + 4 * MIN);
    await h.advance(T0 + 4 * MIN, false);
    expect(h.sent.map((s) => s.at - T0)).toEqual([4 * MIN]);
  });

  it("reads the new session's transcript after bb's new thread/identity, and the old one's facts no longer count", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("t", true);
    expect((await h.engine.viewOf("t"))?.context).toBe(300_000);
    // /clear: bb emits a new identity, and the new session has only a small context.
    h.side("t").session = "session-new";
    h.side("t").ino = 999;
    h.side("t").requests = [];
    h.transcript("t", T0 + MIN, 20_000, "1h");
    h.event("t", "thread/identity", T0 + MIN, { providerThreadId: "session-new" });
    h.now = T0 + MIN;
    await h.ranTurn("t", [], "Cleared.");
    const view = (await h.engine.viewOf("t"))!;
    expect(view.context).toBe(20_000);
    expect(view.compactionDue).toBe(false);
    expect(h.transcriptCursors.at(-1)).toBeNull();
    await h.advance(T0 + 70 * MIN, false);
    expect(h.sent).toEqual([]);
  });
});

describe("a restart", () => {
  it("catches up only threads bb updated since the watermark less a minute, from their saved positions", async () => {
    h.thread({ id: "old", updatedAt: T0 - 10 * MIN });
    h.thread({ id: "near", updatedAt: T0 - 30 * S });
    h.thread({ id: "new", updatedAt: T0 - 10 * MIN });
    for (const id of ["old", "near", "new"]) h.transcript(id, T0 - 10 * MIN, 300_000);
    await h.start();
    for (const id of ["old", "near", "new"]) await h.engine.setCompact(id, true);
    h.engine.stop();
    h.now = T0 + 20 * MIN;
    // While the plugin is down, "new" runs a turn.
    h.turn("new", T0 + 15 * MIN, [], "Did a thing.");
    const events = h.calls.events;
    const cursors = h.transcriptCursors.length;
    await h.restart();
    // "new" was updated after the watermark and "near" within its margin; "old" is left alone.
    expect(h.calls.events - events).toBe(2);
    expect(h.transcriptCursors.slice(cursors).every((c) => c !== null)).toBe(true);
    expect(h.transcriptCursors.length - cursors).toBe(2);
  });

  it("never acts on a deadline more than a minute past after a restart or a stalled timer, and plans from current facts", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    // The machine sleeps through the deadline at 4 min.
    h.now = T0 + 5 * MIN + 30 * S;
    h.engine.clockMoved();
    await h.settle();
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("t"))?.warmPlanned).toBe(false);
  });
});

describe("the surfaces", () => {
  it("serve a view, the overview, row glyphs and a switch change without any work over every tree", async () => {
    for (let i = 0; i < 20; i++) {
      h.thread({ id: `t${i}` });
      h.transcript(`t${i}`, T0, 300_000);
    }
    await h.start();
    await h.engine.setCompact("t0", true);
    const before = { ...h.calls };
    await h.engine.viewOf("t0");
    h.engine.allViews();
    h.engine.switchedOn();
    await h.engine.setSetting("t0", 5);
    await h.engine.skip("t0", "compaction", false);
    expect(h.calls.list).toBe(before.list);
    expect(h.calls.events).toBe(before.events);
    expect(h.calls.transcript).toBe(before.transcript);
    // A thread with no view is read alone.
    await h.engine.viewOf("t7");
    expect(h.calls.transcript).toBe(before.transcript + 1);
    expect(h.calls.list).toBe(before.list);
  });
});

describe("the host keep-alive", () => {
  it("renews the host worker's lease across every gap over 5 minutes while a deadline or stall check is pending", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("t", true);
    await h.advance(T0 + 58 * MIN, false);
    const at = h.retained.map((r) => r.at);
    expect(at.length).toBeGreaterThan(10);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeLessThanOrEqual(5 * MIN);
    expect(at[0]! - T0).toBeLessThanOrEqual(5 * MIN);
  });
});

describe("a turn's end", () => {
  it("sends nothing on what was known before the turn: a keep-warm due by the old deadline waits for the turn to be read", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    // You type at 3:50; the turn ends at 4:10, inside the old deadline's minute.
    h.now = T0 + 3 * MIN + 50 * S;
    h.patch("t", { status: "active" });
    h.emit("active", "t");
    await h.settle();
    h.now = T0 + 4 * MIN + 10 * S;
    const r = h.request("t", h.now - 20 * S, { initiator: "user", input: [{ type: "text", text: "look again", mentions: [] }] });
    h.turn("t", h.now - S, [r], "Looked.");
    h.patch("t", { status: "idle" });
    h.emit("idle", "t");
    await h.settle();
    expect(h.sent).toEqual([]);
    // The new deadline is the turn's request plus the lifetime, less a minute.
    expect(h.engine.dueAt("tree:t")).toBe(T0 + 4 * MIN + 9 * S + 4 * MIN);
  });
});
