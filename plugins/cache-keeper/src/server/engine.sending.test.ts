/**
 * Spend that fails closed, and sends checked against the thread as bb gives
 * it immediately before they go.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { COMPACT_MESSAGE } from "../core/messages";
import { NotReadyError } from "./engine";
import { busy, FakeBb, MIN, PRICE, priced, S, T0 } from "./fake-bb.test.helpers";

let h: FakeBb;
beforeEach(() => {
  h = new FakeBb();
});

const held = () => h.store.history(0, 1000, ["held"]).filter((r) => r.record.reason !== undefined);

describe("spend", () => {
  it("sends no keep-warm to a thread whose model has no price, or a zero or missing cache rate, and says why", async () => {
    for (const [name, prices] of [
      ["unpriced", priced({}) /* the model below is not in it */],
      ["zero read", priced({ cache_read_input_token_cost: 0 })],
      ["zero write", priced({ cache_creation_input_token_cost_above_1hr: 0 })],
    ] as const) {
      h = new FakeBb();
      h.prices = prices;
      h.thread({ id: "t", activity: busy });
      h.transcript("t", T0, 100_000, "1h", name === "unpriced" ? { model: "claude-unknown-9" } : {});
      await h.start();
      await h.advance(T0 + 70 * MIN, false);
      expect(h.sent).toEqual([]);
      const view = (await h.engine.viewOf("t"))!;
      expect(view.warmNoPrice).toBe(true);
      expect(view.decision).toMatchObject({ what: "keep-warm", reason: "no price" });
      expect(h.infos.some((m) => /^t: keep-warm due .* held back: no price$/.test(m))).toBe(true);
    }
  });

  it("charges a keep-warm whose cost cannot be measured its forecast, so the cost stop still comes", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    // No request of the keep-warms' turns reaches the transcript.
    const turn = h.turn.bind(h);
    h.turn = (id, at, requestIds, reply, _usage, status) => turn(id, at, requestIds, reply, false, status);
    await h.start();
    await h.advance(T0 + 3 * 60 * MIN);
    const sent = h.sent.length;
    expect(sent).toBeGreaterThan(0);
    // Each is charged a warm read of the context, and they stop at one cold write of it.
    expect(h.store.get("t").stretch!.chargedUsd).toBeCloseTo(sent * PRICE.read * 100_000, 10);
    expect(sent * PRICE.read * 100_000).toBeLessThanOrEqual(PRICE.write5m * 100_000);
    await h.advance(T0 + 4 * 60 * MIN);
    expect(h.sent.length).toBe(sent);
    // The page shows each at its forecast, marked as an estimate, never $0.
    const entries = h.store.history(0, 1000, ["keep-warm"]);
    expect(entries.every((e) => e.record.usd! > 0 && e.record.estimated === true)).toBe(true);
  });

  it("shows a keep-warm at its forecast, as an estimate, until its turn is measured", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 4 * MIN, false);
    const entry = h.store.history(0, 10, ["keep-warm"])[0]!;
    expect(entry.record).toMatchObject({ estimated: true });
    expect(entry.record.usd).toBeCloseTo(PRICE.read * 100_000, 10);
    await h.deliver();
    const measured = h.store.history(0, 10, ["keep-warm"])[0]!;
    expect(measured.record.estimated).toBe(false);
    expect(measured.record.usd).toBeCloseTo(3 * PRICE.input + 20 * PRICE.output + 100_000 * PRICE.read + 200 * PRICE.write5m, 10);
  });

  it("does not count a send that failed as a keep-warm", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    h.failSend.add("t");
    await h.start();
    await h.advance(T0 + 4 * MIN + S, false);
    expect(h.calls.send).toBeGreaterThan(0);
    expect(h.store.history(0, 10, ["keep-warm"])).toEqual([]);
    expect(h.engine.totals(30).keepWarms).toBe(0);
  });
});

describe("the check before every send", () => {
  /** A thread due a compaction at 59 min, a keep-warm at 4 min and a check-in at 15. */
  const setUp = async () => {
    h.thread({ id: "c" });
    h.transcript("c", T0, 300_000, "1h");
    h.thread({ id: "w", activity: busy });
    h.transcript("w", T0, 100_000, "5m");
    h.thread({ id: "k", activity: busy });
    h.transcript("k", T0, 100_000, "1h");
    h.task("k", "b1", "command", T0);
    h.outputs.set("b1", T0);
    await h.start();
    await h.engine.setCompact("c", true);
    await h.engine.setKeepWarm("k", false);
  };

  for (const [change, reason, apply] of [
    ["turned busy", "busy", (id: string) => h.patch(id, { status: "active" })],
    ["was archived", "archived", (id: string) => h.patch(id, { archivedAt: h.now })],
    ["was deleted", "deleted", (id: string) => h.patch(id, { deletedAt: h.now })],
    ["waits on an answer", "pending-interaction", (id: string) => h.patch(id, { hasPendingInteraction: true })],
    ["is no longer Claude Code", "not-claude-code", (id: string) => h.patch(id, { providerId: "pi" })],
  ] as const) {
    it(`sends nothing to a thread that ${change} between planning and sending, and writes why`, async () => {
      await setUp();
      h.onGet = (id) => apply(id);
      await h.advance(T0 + 60 * MIN, false);
      expect(h.sent).toEqual([]);
      const reasons = new Map(held().map((r) => [`${r.threadId}:${r.record.what}`, r.record.reason]));
      expect(reasons.get("c:compact")).toBe(reason);
      expect(reasons.get("w:keep-warm")).toBe(reason);
      expect(reasons.get("k:check-in")).toBe(reason);
    });
  }

  it("sends nothing to a thread whose switch is flipped off between planning and sending, and writes why", async () => {
    await setUp();
    const flipped = new Set<string>();
    h.onGet = (id) => {
      if (flipped.has(id)) return;
      flipped.add(id);
      if (id === "c") void h.engine.setCompact("c", false);
      if (id === "w") void h.engine.setKeepWarm("w", false);
      if (id === "k") h.checkIns = false;
    };
    await h.advance(T0 + 60 * MIN, false);
    expect(h.sent).toEqual([]);
    const reasons = new Map(held().map((r) => [`${r.threadId}:${r.record.what}`, r.record.reason]));
    expect(reasons.get("c:compact")).toBe("switched-off");
    expect(reasons.get("w:keep-warm")).toBe("switched-off");
    expect(reasons.get("k:check-in")).toBe("switched-off");
  });

  it("takes bb's refusal of a busy thread as busy: nothing retried for that due time, and nothing claims a send", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    h.refuse.add("t");
    await h.start();
    await h.advance(T0 + 5 * MIN - S, false);
    expect(h.calls.send).toBe(1);
    expect(h.store.history(0, 10, ["keep-warm"])).toEqual([]);
    expect((await h.engine.viewOf("t"))?.decision).toMatchObject({ what: "keep-warm", reason: "thread busy" });
  });

  it("treats a reply lacking a field it acts on as don't act, warned once per thread and cause", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    h.drop = ["hasPendingInteraction"];
    await h.start();
    await h.advance(T0 + 20 * MIN, false);
    expect(h.sent).toEqual([]);
    expect(h.warnings.filter((w) => w.includes("hasPendingInteraction"))).toHaveLength(1);
  });

  it("counts a missing pending-interaction list before a send as a pending interaction", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    h.drop = ["pendingInteractions"];
    await h.advance(T0 + 4 * MIN, false);
    expect(h.sent).toEqual([]);
    expect(held().map((r) => r.record.reason)).toEqual(["missing-field"]);
  });
});

describe("a switch flipped while the engine awaits bb or a host", () => {
  for (const when of ["planning a send", "reading its transcript"] as const) {
    it(`holds Compact when idle, Keep warm while waiting, the line, Skip and Undo flipped while ${when}`, async () => {
      h.thread({ id: "t" });
      h.transcript("t", T0, 300_000, "1h");
      await h.start();
      await h.engine.setCompact("t", true, 2);
      await h.engine.skip("t", "warm", false);
      const flip = () => {
        void h.engine.setCompact("t", false);
        void h.engine.setSetting("t", 7);
        void h.engine.setKeepWarm("t", true);
        void h.engine.skip("t", "compaction", false);
        void h.engine.skip("t", "warm", true);
      };
      if (when === "planning a send") {
        h.onGet = () => {
          h.onGet = null;
          flip();
        };
        await h.advance(T0 + 59 * MIN, false);
      } else {
        h.onTranscript = () => {
          h.onTranscript = null;
          flip();
        };
        h.now = T0 + MIN;
        await h.typed("t", "carry on");
      }
      await h.settle();
      const r = h.store.get("t");
      expect(r.compactOn).toBe(false);
      expect(r.setting).toBe(7);
      expect(r.keepWarm).toBe(true);
      expect(r.stretch?.compactSkipped).toBe(true);
      expect(r.stretch?.warmSkipped).toBe(false);
      expect(h.sent.map((s) => s.text)).not.toContain(COMPACT_MESSAGE);
    });
  }
});

describe("the check before a send comes after the machine is asked", () => {
  it("sends no check-in when Skip is pressed, or the thread archived, while its task files are read", async () => {
    for (const change of ["checkIns", "archive"] as const) {
      h = new FakeBb();
      h.thread({ id: "k", activity: busy });
      h.transcript("k", T0, 100_000, "1h");
      h.task("k", "b1", "command", T0);
      h.outputs.set("b1", T0);
      await h.start();
      await h.engine.setKeepWarm("k", false);
      let reads = 0;
      h.onTasks = () => {
        // The first read is the stall check's own; the next is the check-in's.
        if (++reads !== 2) return;
        if (change === "checkIns") h.checkIns = false;
        else h.patch("k", { archivedAt: h.now });
      };
      await h.advance(T0 + 16 * MIN, false);
      expect(h.sent).toEqual([]);
      expect(held().map((r) => r.record.reason)).toEqual([change === "checkIns" ? "switched-off" : "archived"]);
    }
  });
});

describe("a host that does not answer", () => {
  it("holds only the threads on it: a thread on another host in the same tree is served within a second of its due time", async () => {
    h.thread({ id: "p" });
    h.thread({ id: "a", parentThreadId: "p", activity: busy, environmentHostId: "host_down" });
    h.thread({ id: "b", parentThreadId: "p", activity: busy, environmentHostId: "host_up" });
    h.transcript("p", T0, 50_000, "1h");
    h.transcript("a", T0, 50_000, "5m");
    h.transcript("b", T0, 50_000, "5m");
    h.down.add("host_down");
    await h.start();
    await h.advance(T0 + 4 * MIN, false);
    expect(h.sent.map((s) => [s.threadId, s.at - T0])).toEqual([["b", 4 * MIN]]);
    expect((await h.engine.viewOf("a"))?.warmPlanned).toBe(false);
  });
});

describe("one send per thread and due time", () => {
  it("sends one compaction when Compact now and the automatic one fall due at once", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 300_000, "1h");
    await h.start();
    await h.engine.setCompact("t", true);
    h.now = T0 + 59 * MIN;
    const [manual] = await Promise.allSettled([h.engine.compactNow("t"), h.advance(T0 + 59 * MIN, false)]);
    await h.settle();
    expect(h.sent.filter((s) => s.text === COMPACT_MESSAGE)).toHaveLength(1);
    if (manual.status === "rejected") expect(manual.reason).toBeInstanceOf(NotReadyError);
  });

  it("does not send again after a restart during a send", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    // The plugin stopped after claiming the keep-warm due at 4 min and before bb answered.
    h.store.claimSend({ threadId: "t", at: T0 + 4 * MIN, dueKey: `keep-warm:${T0}`, kind: "keep-warm", hash: "x", stretchStartedAt: T0, forecastUsd: 0 });
    await h.restart();
    await h.advance(T0 + 4 * MIN + 30 * S, false);
    expect(h.sent).toEqual([]);
    expect(h.infos.some((m) => m.includes("held back: already sent"))).toBe(true);
  });
});
