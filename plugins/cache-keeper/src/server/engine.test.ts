import { beforeEach, describe, expect, it } from "vitest";
import { COMPACT_MESSAGE } from "../core/messages";
import { sentKind } from "../core/messages";
import { ClaudeOnlyError, NoTreeTopError, NotReadyError } from "./engine";
import { busy, FakeBb, MIN, PRICE, queued, reportRow, S, T0, type Requested, type Row } from "./fake-bb.test.helpers";

let h: FakeBb;
beforeEach(() => {
  h = new FakeBb();
});

const texts = () => h.sent.map((s) => s.text);
const kinds = () => h.sent.map((s) => sentKind(s.text));
/** Keep-warms sent so far, by thread. */
const warmed = () => h.sent.filter((x) => sentKind(x.text) === "keep-warm").map((x) => x.threadId);

describe("compact when idle", () => {
  it("compacts an idle thread over its line a minute before its cache expires, once per idle stretch", async () => {
    h.thread({ id: "t1" });
    h.transcript("t1", T0, 300_000);
    await h.start();
    await h.engine.setCompact("t1", true);
    await h.settle();

    await h.advance(T0 + 30 * MIN);
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("t1"))?.compactionDue).toBe(true);
    expect(h.engine.dueAt("tree:t1")).toBe(T0 + 59 * MIN);

    await h.advance(T0 + 59 * MIN, false);
    expect(texts()).toEqual([COMPACT_MESSAGE]);
    expect(h.sent[0]!.at).toBe(T0 + 59 * MIN);

    // The compaction's own turn stays inside the stretch, and nothing more is sent in it.
    h.side("t1").facts = { ...h.side("t1").facts, lastCompaction: { at: h.now, preTokens: 300_000, postTokens: 10_000 } };
    await h.deliver();
    const entry = h.store.history(0).find((r) => r.kind === "compaction")!;
    expect(entry.record.contextAfter).toBe(10_000);
    // `/compact` leaves no usage in the transcript, so the entry keeps its estimate rather than $0.
    expect(entry.record.usd).toBeCloseTo(300_000 * PRICE.read + 20_000 * PRICE.output, 10);
    await h.advance(T0 + 125 * MIN);
    expect(h.sent).toHaveLength(1);
  });

  it("does nothing on a thread under its line, switched off, or waiting", async () => {
    h.thread({ id: "under" });
    h.thread({ id: "off" });
    h.thread({ id: "busy", activity: busy });
    h.transcript("under", T0, 50_000);
    h.transcript("off", T0, 300_000);
    h.transcript("busy", T0, 300_000);
    h.keepWarm = "never";
    await h.start();
    await h.engine.setCompact("under", true);
    await h.engine.setCompact("busy", true);
    await h.advance(T0 + 70 * MIN);
    expect(h.sent).toEqual([]);
  });

  it("does not compact a parent between a child's turn ending and bb's report of it arriving", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p" });
    h.transcript("p", T0, 300_000);
    h.transcript("c", T0, 50_000);
    await h.start();
    await h.engine.setCompact("p", true);
    h.now = T0 + 59 * MIN - 3 * S;
    // The child's turn has just ended; its report is not in yet.
    await h.ranTurn("c", [], "Finished the page.");
    expect((await h.engine.viewOf("p"))?.waiting).toBe(true);
    await h.advance(T0 + 59 * MIN + 30 * S);
    expect(texts()).not.toContain(COMPACT_MESSAGE);
  });

  it("does not hold a tree for a report bb queued behind a question", async () => {
    h.thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" });
    h.thread({ id: "a", parentThreadId: "p" });
    h.thread({ id: "b", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("b", T0, 100_000, "5m");
    h.side("p").queued = [reportRow("row", T0 + 230 * S, [{ id: "a", reply: "Finished the page." }])];
    await h.start();
    h.now = T0 + 230 * S;
    await h.ranTurn("a", [], "Finished the page.");
    await h.advance(T0 + 240 * S, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["b"]);
  });

  it("does not send a compaction whose deadline passed while the server was down", async () => {
    h.thread({ id: "t1" });
    h.transcript("t1", T0, 300_000);
    await h.start();
    await h.engine.setCompact("t1", true);
    h.engine.stop();
    h.now = T0 + 61 * MIN;
    await h.restart();
    await h.advance(T0 + 70 * MIN);
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("t1"))?.compactOn).toBe(true);
  });

  it("acts at the transcript's deadline after a restart, reading the transcript on from its stored cursor", async () => {
    h.thread({ id: "t1" });
    h.transcript("t1", T0, 300_000);
    await h.start();
    await h.engine.setCompact("t1", true);
    await h.settle();
    h.now = T0 + 10 * MIN;
    const reads = h.transcriptCursors.length;
    await h.restart();
    expect(h.transcriptCursors.slice(reads).every((c) => c !== null)).toBe(true);
    await h.advance(T0 + 59 * MIN + 10 * S, false);
    expect(texts()).toEqual([COMPACT_MESSAGE]);
  });

  it("refuses threads that are not Claude Code", async () => {
    h.thread({ id: "pi", providerId: "pi" });
    await h.start();
    await expect(h.engine.setCompact("pi", true)).rejects.toBeInstanceOf(ClaudeOnlyError);
    expect(await h.engine.viewOf("pi")).toBeNull();
  });

  it("starts a thread at the setting last chosen, or 2", async () => {
    for (const id of ["a", "b", "c"]) {
      h.thread({ id });
      h.transcript(id, T0, 1);
    }
    await h.start();
    expect((await h.engine.setCompact("a", true))?.setting).toBe(2);
    await h.engine.setSetting("a", 5);
    expect((await h.engine.setCompact("b", true))?.setting).toBe(5);
    await h.engine.setCompact("c", true, 3);
    expect((await h.engine.viewOf("c"))?.setting).toBe(3);
  });

  it("compacts now under the line, whatever Compact when idle says, but not while waiting", async () => {
    h.thread({ id: "t1" });
    h.thread({ id: "t2", queuedWork: "waiting" });
    h.side("t2").queued = [queued({ id: "q1", createdAt: T0 })];
    h.transcript("t1", T0, 20_000);
    h.transcript("t2", T0, 20_000);
    await h.start();
    await h.engine.compactNow("t1");
    expect(h.sent.map((s) => s.threadId)).toEqual(["t1"]);
    await expect(h.engine.compactNow("t2")).rejects.toBeInstanceOf(NotReadyError);
  });
});

describe("keeping a thread tree warm", () => {
  it("keeps a thread waiting on background work warm at its deadline with an unconditional keep-warm", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 200_000);
    await h.start();
    await h.advance(T0 + 59 * MIN - S, false);
    expect(h.sent).toEqual([]);
    expect(h.engine.dueAt("tree:t")).toBe(T0 + 59 * MIN);
    await h.advance(T0 + 59 * MIN, false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.at).toBe(T0 + 59 * MIN);
    expect(h.sent[0]!.text).toMatch(/^Still waiting on .*There's no need to check anything\. Reply with exactly "Not finished yet, still waiting on .*\. Nothing needed from you\."$/);
  });

  it("sends only the child of a 1-hour parent over a 5-minute child, and the parent takes one report turn per keep-warm", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 20 * MIN);
    const toParent = h.sent.filter((s) => s.threadId === "p");
    const toChild = h.sent.filter((s) => s.threadId === "c");
    expect(toParent).toEqual([]);
    expect(toChild.length).toBeGreaterThan(3);
    expect(h.reportTurns("p")).toBe(toChild.length);
    // Those report turns are not your messages in the parent's calls per message.
    expect(h.store.get("p").keeperReports).toEqual({ turns: toChild.length, requests: toChild.length });
    // Each keep-warm went at the child's deadline: every 240 seconds, a cache lifetime less the minute's margin.
    const times = h.sides.get("c")!.requests.map((r) => r.at);
    for (let i = 2; i < times.length; i++) expect(Math.abs(times[i]! - times[i - 1]! - 240 * S)).toBeLessThanOrEqual(5 * S);
  });

  it("stops the child's keep-warms within its first hour under a 1-hour parent of similar size", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 70 * MIN);
    const last = h.sent.filter((s) => s.threadId === "c").length;
    await h.advance(T0 + 90 * MIN);
    expect(h.sent.filter((s) => s.threadId === "c").length).toBe(last);
    const lastAt = h.sides.get("c")!.requests.at(-1)!.at;
    expect(lastAt).toBeLessThan(T0 + 60 * MIN);
    // Each keep-warm cost a read of the child's context and of the parent's, charged to the child.
    const charged = h.store.get("c").stretch!.chargedUsd;
    expect(charged).toBeLessThanOrEqual(PRICE.write5m * 100_000);
    expect(charged).toBeGreaterThan(PRICE.write5m * 100_000 * 0.7);
    expect((await h.engine.viewOf("c"))?.warmPlanned).toBe(false);
  });

  it("sends a shallower leaf when the report from a deeper one reaches its level, so the parent takes one report turn", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c1", parentThreadId: "p" });
    h.thread({ id: "g", parentThreadId: "c1", activity: busy });
    h.thread({ id: "c2", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 20_000, "1h");
    h.transcript("c1", T0, 20_000, "1h");
    h.transcript("g", T0, 20_000, "5m");
    h.transcript("c2", T0, 20_000, "5m");
    await h.start();
    await h.advance(T0 + 4 * MIN, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["g"]);
    await h.deliver();
    expect(h.sent.map((x) => x.threadId)).toEqual(["g", "c2"]);
    expect(h.reportTurns("p")).toBe(1);
    const entry = h.store.history(0).find((r) => r.kind === "keep-warm")!;
    expect(entry.record.threads).toEqual(["g", "c2"]);
    expect(entry.threadId).toBe("p");
  });

  it("sends the parent nothing while its child's keep-warm turn is still running", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "5m");
    h.transcript("c", T0 + 10 * S, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 150 * S, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["c"]);
    // The keep-warm's turn starts and runs a minute; bb lists the child as working.
    h.startTurn("c");
    await h.advance(T0 + 205 * S, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["c"]);
  });

  it("starts no tree keep-warm between bb requesting a report and the turn that takes it", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "5m");
    h.transcript("c", T0 + 10 * S, 100_000, "5m");
    await h.start();
    h.now = T0 + 150 * S - 6 * S;
    await h.ranTurn("c", [], "Not finished yet.");
    h.now = T0 + 150 * S - 3 * S;
    h.requestReport("p", "c");
    await h.advance(T0 + 150 * S, false);
    expect(h.sent).toEqual([]);
  });

  it("holds a shallower leaf due at the same deadline until the report from below reaches its level, 30 s at most", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c1", parentThreadId: "p" });
    h.thread({ id: "g", parentThreadId: "c1", activity: busy });
    h.thread({ id: "c2", parentThreadId: "p", activity: busy });
    for (const id of ["p", "c1"]) h.transcript(id, T0, 20_000, "1h");
    // Aligned: both leaves' deadlines fall at 4 min.
    h.transcript("g", T0, 20_000, "5m");
    h.transcript("c2", T0, 20_000, "5m");
    await h.start();
    await h.advance(T0 + 4 * MIN, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["g"]);
    expect(h.engine.dueAt("tree:p")).toBe(T0 + 4 * MIN + 30 * S);
    await h.advance(T0 + 4 * MIN + 29 * S, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["g"]);
    await h.advance(T0 + 4 * MIN + 30 * S, false);
    expect(h.sent.map((x) => x.threadId)).toEqual(["g", "c2"]);
  });

  it("aligns three children so the parent takes one batched report turn per cycle", async () => {
    h.thread({ id: "p" });
    for (const id of ["a", "b", "c"]) h.thread({ id, parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 20_000, "1h");
    h.transcript("a", T0, 20_000, "5m");
    h.transcript("b", T0 + 50 * S, 20_000, "5m");
    h.transcript("c", T0 + 100 * S, 20_000, "5m");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    const reportsBefore = h.reportTurns("p");
    const sentBefore = h.sent.length;
    await h.advance(T0 + 20 * MIN);
    const sends = h.sent.slice(sentBefore);
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.length % 3).toBe(0);
    expect(h.reportTurns("p") - reportsBefore).toBe(sends.length / 3);
    // One page entry per send moment, naming the three threads.
    const entries = h.store.history(0, 1000, ["keep-warm"]).filter((r) => r.at >= T0 + 5 * MIN);
    expect(entries.every((e) => e.record.threads?.length === 3)).toBe(true);
  });

  it("sends nothing below a thread you skipped, and nothing with the setting off or a pending interaction", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.engine.skip("p", "warm", false);
    await h.advance(T0 + 10 * MIN);
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("c"))?.warmPlanned).toBe(false);

    await h.engine.skip("p", "warm", true);
    h.keepWarm = "never";
    h.engine.clockMoved();
    await h.advance(T0 + 12 * MIN);
    h.keepWarm = "every";
    h.patch("c", { hasPendingInteraction: true });
    h.emit("pending", "c");
    h.transcript("c", h.now, 100_000, "5m");
    await h.ranTurn("c", [], "Asked you something.");
    await h.advance(h.now + 5 * MIN);
    expect(h.sent).toEqual([]);
  });

  it("keeps the idle stretch through Cache Keeper's turns and their reports, and ends it on one you type", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    const stretch = h.store.get("p").stretch!.startedAt;
    await h.advance(T0 + 10 * MIN);
    expect(h.store.get("p").stretch?.startedAt).toBe(stretch);
    expect(h.store.get("c").stretch?.chargedUsd).toBeGreaterThan(0);
    await h.typed("c", "also update the docs");
    expect(h.store.get("c").stretch?.chargedUsd ?? 0).toBe(0);
  });

  it("charges a batched report turn split equally between the children it reports", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "a", parentThreadId: "p", activity: busy });
    h.thread({ id: "b", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 40_000, "1h");
    h.transcript("a", T0, 10_000, "5m");
    h.transcript("b", T0, 10_000, "5m");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    const entry = h.store.history(0, 1000, ["keep-warm"]).at(-1)!;
    expect(entry.record.threads).toEqual(["a", "b"]);
    const read = (tokens: number) => 3 * PRICE.input + 20 * PRICE.output + tokens * PRICE.read;
    expect(entry.record.split!.p).toBeCloseTo(read(40_000) + 200 * PRICE.write1h, 10);
    expect(entry.record.split!.a).toBeCloseTo(read(10_000) + 200 * PRICE.write5m, 10);
    expect(entry.record.usd).toBeCloseTo(entry.record.split!.a! + entry.record.split!.b! + entry.record.split!.p!, 10);
    expect(entry.record.estimated).toBe(false);
    expect(h.store.get("a").stretch!.chargedUsd).toBeCloseTo(entry.record.split!.a! + entry.record.split!.p! / 2, 10);
  });

  it("takes a report bb delivers without a kind as real, and logs it once", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    h.reportFields = ({ systemMessageKind: _, ...r }) => r;
    await h.start();
    const stretch = h.store.get("p").stretch!.startedAt;
    await h.advance(T0 + 240 * S);
    expect(h.reportTurns("p")).toBe(1);
    expect(h.warnings).toEqual([expect.stringMatching(/^request creq_\d+ into p: a system message mentioning a thread has no systemMessageKind/)]);
    expect(h.store.get("p").stretch?.startedAt ?? null).not.toBe(stretch);
    expect(h.store.get("p").keeperReports.turns).toBe(0);
  });

  it("attributes the same way after a restart between the keep-warm and its report", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 240 * S, false);
    expect(h.sent).toHaveLength(1);
    const stretch = h.store.get("p").stretch!.startedAt;
    await h.restart();
    await h.deliver();
    expect(h.store.get("p").stretch?.startedAt).toBe(stretch);
    expect(h.store.get("c").stretch!.chargedUsd).toBeGreaterThan(0);
  });
});

describe("keep warm while waiting", () => {
  it("sends no keep-warm with the settings as installed and no switch flipped, and still checks in on a stalled task", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000);
    h.task("t", "b1", "command", T0);
    await h.start();
    await h.advance(T0 + 59 * MIN, false);
    expect(warmed()).toEqual([]);
    expect(new Set(kinds())).toEqual(new Set(["check-in"]));
    const view = (await h.engine.viewOf("t"))!;
    expect(view).toMatchObject({ keptWarm: false, warmPlanned: false, warmSetting: "switched", treeTop: { threadId: "t" } });
  });

  for (const [setting, untouched] of [["every", true], ["switched", false], ["never", false]] as const) {
    for (const flipped of [null, true, false]) {
      const expected = setting === "never" ? false : (flipped ?? untouched);
      it(`${expected ? "keeps" : "does not keep"} a waiting thread warm under ${setting} with its switch ${flipped === null ? "untouched" : flipped ? "flipped on" : "flipped off"}`, async () => {
        h.keepWarm = setting;
        h.thread({ id: "t", activity: busy });
        h.transcript("t", T0, 100_000);
        await h.start();
        if (flipped !== null) await h.engine.setKeepWarm("t", flipped);
        await h.advance(T0 + 59 * MIN, false);
        expect(warmed()).toEqual(expected ? ["t"] : []);
        expect((await h.engine.viewOf("t"))?.keptWarm).toBe(expected);
      });
    }
  }

  it("follows a change of setting live on an untouched tree top, and keeps a flipped one's record through Never", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "a", activity: busy });
    h.thread({ id: "b", activity: busy });
    await h.start();
    await h.engine.setKeepWarm("b", false);
    h.keepWarm = "every";
    // A change of setting replans, as server.ts does on bb's onChange.
    h.engine.clockMoved();
    expect((await h.engine.viewOf("a"))?.keptWarm).toBe(true);
    expect((await h.engine.viewOf("b"))?.keptWarm).toBe(false);
    h.keepWarm = "never";
    await h.engine.setKeepWarm("b", true);
    h.engine.clockMoved();
    expect((await h.engine.viewOf("b"))?.keptWarm).toBe(false);
    h.keepWarm = "switched";
    h.engine.clockMoved();
    expect((await h.engine.viewOf("a"))?.keptWarm).toBe(false);
    expect((await h.engine.viewOf("b"))?.keptWarm).toBe(true);
  });

  it("keeps the switch through a restart", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000);
    await h.start();
    await h.engine.setKeepWarm("t", true);
    await h.restart();
    await h.advance(T0 + 59 * MIN, false);
    expect(warmed()).toEqual(["t"]);
  });

  it("records Keep warm from a child on its Claude Code tree top, and keeps the whole tree warm", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p" });
    h.thread({ id: "g", parentThreadId: "c", activity: busy });
    for (const id of ["p", "c"]) h.transcript(id, T0, 20_000, "1h");
    h.transcript("g", T0, 20_000, "5m");
    await h.start();
    h.now = T0 + 3 * MIN;
    expect((await h.engine.viewOf("g"))?.treeTop).toEqual({ threadId: "p", title: "p" });
    const result = await h.engine.setKeepWarm("g", true);
    expect(result).toMatchObject({ treeTop: { threadId: "p" }, keptWarm: true, never: false });
    expect(h.store.get("p").keepWarm).toBe(true);
    expect(h.store.get("g").keepWarm).toBeNull();
    expect(await h.engine.viewOf("g")).toMatchObject({ keptWarm: true, warmPlanned: true });
    await h.advance(T0 + 15 * MIN);
    expect(warmed().filter((id) => id === "g").length).toBeGreaterThanOrEqual(2);

    // Switched off again, the tree gets no more.
    await h.engine.setKeepWarm("p", false);
    const before = warmed().length;
    await h.advance(T0 + 30 * MIN);
    expect(warmed().length).toBe(before);
  });

  it("switches each Claude Code branch under a root that is not Claude Code on its own", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "root", providerId: "pi" });
    h.thread({ id: "a", parentThreadId: "root", activity: busy });
    h.thread({ id: "b", parentThreadId: "root", activity: busy });
    for (const id of ["a", "b"]) h.transcript(id, T0, 20_000, "1h");
    await h.start();
    await h.engine.setKeepWarm("a", true);
    await h.advance(T0 + 59 * MIN, false);
    expect(warmed()).toEqual(["a"]);
    expect((await h.engine.viewOf("b"))?.treeTop.threadId).toBe("b");
    const refused = await h.engine.setKeepWarm("root", true).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(NoTreeTopError);
    expect((refused as NoTreeTopError).below.map((t) => t.threadId)).toEqual(["a", "b"]);
    expect(h.store.has("root")).toBe(false);
  });

  it("keeps a thread spawned under a switched-on tree top warm", async () => {
    h.keepWarm = "switched";
    h.thread({ id: "p" });
    h.transcript("p", T0, 20_000, "1h");
    await h.start();
    await h.engine.setKeepWarm("p", true);
    // bb's created event carries neither its question nor its background count: the next reconciliation check does.
    h.thread({ id: "late", parentThreadId: "p", status: "active", createdAt: T0 + MIN, activity: busy });
    h.emit("created", "late");
    h.transcript("late", T0 + 2 * MIN, 20_000, "1h");
    h.now = T0 + 2 * MIN;
    await h.ranTurn("late", [], "Started the build.");
    h.transcript("late", T0 + 2 * MIN, 20_000, "1h");
    await h.advance(T0 + 62 * MIN, false);
    expect(warmed()).toContain("late");
  });

  it("checks in on a switched-off tree, and not at all with the checkbox off, where a keep-warm asks about no task", async () => {
    const withTask = async () => {
      h.thread({ id: "t", activity: busy });
      h.transcript("t", T0, 100_000);
      h.task("t", "b1", "command", T0);
      await h.start();
    };
    await withTask();
    await h.engine.setKeepWarm("t", false);
    await h.advance(T0 + 16 * MIN, false);
    expect(kinds()).toEqual(["check-in"]);

    h = new FakeBb();
    h.checkIns = false;
    // Printing all along, so the 59-minute keep-warm would otherwise ask about it.
    h.outputs.set("b1", T0 + 58 * MIN);
    await withTask();
    await h.advance(T0 + 59 * MIN, false);
    expect(kinds()).toEqual(["keep-warm"]);
    expect(h.sent[0]!.text).not.toContain("has been running");
  });
});

describe("read state", () => {
  it("puts a read thread back to read after a keep-warm that brought nothing new and the parent's report of it", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    expect(h.reportTurns("p")).toBe(1);
    const p = h.get("p");
    expect(p.lastReadAt! >= p.latestAttentionAt).toBe(true);
    // Putting it back writes a history row naming the thread.
    expect(h.store.history(0, 100, ["held"]).some((r) => r.threadId === "p" && r.record.what === "read-state-restored")).toBe(true);
  });

  it("marks a child unread again when it was unread before the keep-warm", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy, lastReadAt: null });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    expect(h.sent.map((s) => s.threadId)).toEqual(["c"]);
    expect(h.get("c").lastReadAt).toBeNull();
  });

  it("leaves an unread thread unread, though bb marked it read when the keep-warm arrived", async () => {
    h.thread({ id: "t", activity: busy, lastReadAt: T0 - MIN, latestAttentionAt: T0 });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    expect(h.sent).toHaveLength(1);
    const t = h.get("t");
    expect(t.lastReadAt === null || t.lastReadAt < t.latestAttentionAt).toBe(true);
  });

  it("leaves unread a keep-warm whose reply is news, and the parent's report of it", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    h.replies.set("c", "The deploy failed; I restarted it.");
    await h.start();
    await h.advance(T0 + 5 * MIN);
    const p = h.get("p");
    expect(p.lastReadAt! < p.latestAttentionAt).toBe(true);
  });

  it("keeps a thread read when you read it during the turn, though the turn's end drew attention to it", async () => {
    h.thread({ id: "t", activity: busy, lastReadAt: T0 - MIN, latestAttentionAt: T0 });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 240 * S, false);
    expect(h.sent).toHaveLength(1);
    h.now += 500;
    h.patch("t", { lastReadAt: h.now });
    await h.deliver();
    const t = h.get("t");
    expect(t.lastReadAt! >= t.latestAttentionAt).toBe(true);
  });

  it("leaves the read state as you set it during the turn", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 240 * S, false);
    expect(h.sent).toHaveLength(1);
    h.patch("t", { lastReadAt: null });
    await h.deliver();
    expect(h.get("t").lastReadAt).toBeNull();
  });
});

describe("queued reports", () => {
  /** Keeps `p`'s last report in its queue, as bb does behind a question, instead of delivering it. */
  const queueLastReport = (id: string) => {
    // bb announces the question again; in the fake, the report's turn ran before it was moved to the queue.
    h.emit("pending", "p");
    const report = h.side("p").events.filter((e) => e.type === "client/turn/requested").at(-1)!;
    const row = queued({ id, createdAt: h.now, initiator: "system", content: (report.data as Requested).input });
    h.side("p").events = h.side("p").events.slice(0, h.side("p").events.indexOf(report));
    return row;
  };

  it("deletes report rows that bring nothing new from a thread waiting on your answer, and does not wait on them", async () => {
    h.thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 240 * S);
    const row = queueLastReport("row1");
    h.now += S;
    await h.queueRow("p", { id: "row2", createdAt: h.now, initiator: "system", content: reportRow("row2", h.now, [{ id: "x", reply: "done" }]).content });
    await h.queueRow("p", { id: "row1", createdAt: row.createdAt, initiator: "system", content: row.content });
    expect(h.deleted).toEqual(["row1"]);
    expect(h.store.history(0, 100, ["held"]).some((r) => r.threadId === "p" && r.record.what === "report-row-deleted")).toBe(true);
  });

  it("never deletes a queued system row whose text does not start [bb system], whatever it mentions", async () => {
    h.thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" });
    h.thread({ id: "c", parentThreadId: "p", activity: busy });
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 240 * S);
    const row = queueLastReport("row1");
    const [block] = row.content as { type: "text"; text: string; mentions: unknown[] }[];
    h.now += S;
    await h.queueRow("p", { id: "row1", createdAt: h.now, initiator: "system", content: [{ ...block!, text: block!.text.replace("[bb system]", "[bb]") }] });
    expect(h.deleted).toEqual([]);
  });
});

describe("check-ins", () => {
  const withTask = async (over: Partial<Row> = {}) => {
    h.thread({ id: "t1", activity: busy, ...over });
    h.transcript("t1", T0, 100_000);
    h.task("t1", "b1", "command", T0);
    await h.start();
  };

  it("checks in on a background command as soon as it stalls, even after Skip, asking for the Checked reply", async () => {
    h.outputs.set("b1", T0 + MIN);
    await withTask();
    await h.advance(T0 + 10 * MIN, false);
    await h.engine.skip("t1", "warm", false);
    expect(h.sent).toEqual([]);
    await h.advance(T0 + 16 * MIN - S, false);
    expect(h.sent).toEqual([]);
    await h.advance(T0 + 16 * MIN, false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.at).toBe(T0 + 16 * MIN);
    expect(h.sent[0]!.text).toContain('Background command b1 ("npm test") hasn\'t printed anything in 15 minutes.');
    expect(h.sent[0]!.text).toContain('reply with exactly "Checked b1, still running normally, nothing new. Nothing needed from you."');
    expect(h.store.history(0, 100, ["check-in"])[0]?.record.tasks?.map((t) => t.id)).toEqual(["b1"]);
  });

  it("keeps today's spacing on one stalled task: the wait, then twice as long each time, until it prints again", async () => {
    h.outputs.set("b1", T0);
    await withTask();
    await h.advance(T0 + 130 * MIN);
    const at = h.sent.filter((s) => sentKind(s.text) === "check-in").map((s) => (s.at - T0) / MIN);
    expect(at).toEqual([15, 45, 105]);
    // It prints at 131 minutes, then goes quiet: the next check (due at 225) finds the spacing restarted.
    h.outputs.set("b1", T0 + 131 * MIN);
    await h.advance(T0 + 260 * MIN);
    expect(h.sent.filter((s) => sentKind(s.text) === "check-in").map((s) => (s.at - T0) / MIN)).toEqual([15, 45, 105, 225, 255]);
  });

  it("sends no check-in with the setting off, as on a fresh install", async () => {
    h.checkIns = false;
    h.keepWarm = "switched";
    await withTask();
    await h.advance(T0 + 120 * MIN);
    expect(h.sent).toEqual([]);
  });

  it("charges a check-in its own request, not that of your turn that ended just before it", async () => {
    h.outputs.set("b1", T0 + MIN);
    await withTask();
    h.now = T0 + 16 * MIN - 2 * S;
    await h.typed("t1", "how is it going");
    await h.advance(T0 + 16 * MIN + S, false);
    expect(h.sent).toHaveLength(1);
    await h.deliver();
    const entry = h.store.history(0, 100, ["check-in"])[0]!;
    expect(entry.record.usd).toBeCloseTo(3 * PRICE.input + 20 * PRICE.output + 100_000 * PRICE.read + 200 * PRICE.write1h, 10);
  });

  it("sends no routine check-in, and folds a task running 30 minutes into the next keep-warm", async () => {
    h.outputs.set("b1", T0 + 38 * MIN);
    await withTask();
    // Printing all along: never stalled.
    h.transcript("t1", T0 + 35 * MIN, 100_000, "5m");
    h.now = T0 + 35 * MIN;
    await h.ranTurn("t1", [], "Watching it.");
    h.transcript("t1", T0 + 35 * MIN, 100_000, "5m");
    h.engine.clockMoved();
    await h.advance(T0 + 39 * MIN, false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toMatch(/^Still waiting on background command b1/);
    expect(h.sent[0]!.text).toContain("has been running 39 minutes and is still printing");
    expect(h.sent[0]!.text).toContain('"Checked b1, still running normally, nothing new. Nothing needed from you."');
    expect(h.store.history(0, 100, ["keep-warm"])[0]?.record.folded).toEqual(["b1"]);
  });

  it("holds a check-in back when the machine's files cannot be read", async () => {
    await withTask();
    h.down.add("host_1");
    await h.advance(T0 + 16 * MIN);
    expect(h.sent).toEqual([]);
  });
});

describe("waiting", () => {
  it("waits on a child whose queue holds a failed message beside a pending one", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "c", parentThreadId: "p", queuedWork: "failed" });
    h.side("c").queued = [queued({ id: "q1", createdAt: T0, failureReason: "delivery failed" }), queued({ id: "q2", createdAt: T0 })];
    h.transcript("p", T0, 200_000);
    h.transcript("c", T0, 200_000);
    await h.start();
    expect((await h.engine.viewOf("p"))?.waiting).toBe(true);
    expect((await h.engine.viewOf("c"))?.counts.queued).toBe(1);
  });
});

describe("the CLI's tree rule", () => {
  it("counts threads in the same thread tree by bb's parent links, archived ancestors included, and no other", async () => {
    h.thread({ id: "root", providerId: "pi" });
    h.thread({ id: "mid", parentThreadId: "root", archivedAt: T0 });
    h.thread({ id: "leaf", parentThreadId: "mid" });
    h.thread({ id: "sib", parentThreadId: "root" });
    h.thread({ id: "other" });
    await h.start();
    expect(await h.engine.sameTree("leaf", "sib")).toBe(true);
    expect(await h.engine.sameTree("sib", "root")).toBe(true);
    expect(await h.engine.sameTree("leaf", "other")).toBe(false);
    expect(await h.engine.sameTree("leaf", "thr_missing")).toBe(false);
  });
});
