/** The window rule, the log of decisions, and an unreadable transcript. */
import { beforeEach, describe, expect, it } from "vitest";
import { chipText } from "../core/view";
import { busy, FakeBb, MIN, T0 } from "./fake-bb.test.helpers";

let h: FakeBb;
beforeEach(() => {
  h = new FakeBb();
});

describe("the context window", () => {
  it("gives a thread no lines until bb reports its window, and the chip shows its no-line label", async () => {
    h.thread({ id: "t" });
    h.side("t").window = null;
    h.transcript("t", T0, 300_000);
    await h.start();
    const view = (await h.engine.setCompact("t", true))!;
    expect(view.windowKnown).toBe(false);
    expect(view.lines.every((l) => l === null)).toBe(true);
    expect(chipText(view, T0)).toBe("no line");
    await h.advance(T0 + 70 * MIN, false);
    expect(h.sent).toEqual([]);
    expect(h.infos.some((m) => /compact due .* held back: window unknown/.test(m))).toBe(true);
    // bb reports it at the end of the thread's next turn.
    h.side("t").window = 200_000;
    await h.typed("t", "go on");
    expect((await h.engine.viewOf("t"))?.windowKnown).toBe(true);
  });

  it("shows a chosen setting whose line no longer fits as never when the model and its window change, leaving the setting", async () => {
    h.thread({ id: "t" });
    h.transcript("t", T0, 150_000);
    await h.start();
    const before = (await h.engine.setCompact("t", true, 9))!;
    expect(before.line).not.toBeNull();
    h.side("t").window = 200_000;
    h.transcript("t", T0 + MIN, 150_000, "1h", { model: "claude-opus-5-5[200k]" });
    h.now = T0 + MIN;
    await h.typed("t", "switch model");
    const after = (await h.engine.viewOf("t"))!;
    expect(after.setting).toBe(9);
    expect(after.window).toBe(200_000);
    expect(after.line).toBeNull();
    expect(after.lines[0]).not.toBeNull();
    expect(h.store.get("t").setting).toBe(9);
  });
});

describe("the log of decisions", () => {
  it("logs each send and each hold at info with the thread, what was due and why, and no message text", async () => {
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    await h.start();
    await h.advance(T0 + 4 * MIN);
    await h.engine.skip("t", "warm", false);
    await h.advance(T0 + 12 * MIN, false);
    expect(h.infos.some((m) => /^t: sending keep-warm \(keep-warm:\d+\)$/.test(m))).toBe(true);
    expect(h.infos.some((m) => /^t: keep-warm due \(keep-warm:\d+\) held back: skipped$/.test(m))).toBe(true);
    expect(h.infos.every((m) => !m.includes("Still waiting") && !m.includes("Not finished"))).toBe(true);
  });
});

describe("an unreadable transcript", () => {
  it("shows as transcript unreadable in status, holds the thread's sends, and is logged once", async () => {
    const { describe: statusOf } = await import("./status");
    h.thread({ id: "t", activity: busy });
    h.transcript("t", T0, 100_000, "5m");
    h.side("t").unreadable = "no line of the 3 read parses as JSON";
    await h.start();
    await h.typed("t", "one");
    await h.typed("t", "two");
    await h.advance(T0 + 20 * MIN, false);
    expect(h.sent).toEqual([]);
    const view = (await h.engine.viewOf("t"))!;
    expect(statusOf(view, h.now, null)).toMatch(/status: transcript unreadable/);
    expect(h.warnings.filter((w) => w.includes("unreadable"))).toHaveLength(1);
  });
});
