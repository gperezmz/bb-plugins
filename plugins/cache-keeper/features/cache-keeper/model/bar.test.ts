import { describe, expect, it } from "vitest";
import { chipText, countsText, statusText, type ThreadView } from "@/src/core/view";
import { formatUsd, fractionOf, settingAt, settingForText, stepSetting } from "./bar";

const lines = [100_000, 150_000, 220_000, 400_000, null, null, null, null, null, null];

describe("the context bar", () => {
  it("places sizes along the window", () => {
    expect(fractionOf(250_000, 1_000_000)).toBe(0.25);
    expect(fractionOf(2_000_000, 1_000_000)).toBe(1);
  });

  it("snaps a drag to the nearest setting with a line", () => {
    expect(settingAt(0.16, lines, 1_000_000)).toBe(2);
    expect(settingAt(0.95, lines, 1_000_000)).toBe(4);
  });

  it("steps over settings without a line", () => {
    expect(stepSetting(4, 1, lines)).toBe(4);
    expect(stepSetting(2, -1, lines)).toBe(1);
  });

  it("snaps a typed size", () => {
    expect(settingForText("500k", lines)).toBe(4);
    expect(settingForText("0.15m", lines)).toBe(2);
    expect(settingForText("soon", lines)).toBeNull();
  });

  it("formats dollars", () => {
    expect(formatUsd(1.236)).toBe("$1.24");
    expect(formatUsd(0.001)).toBe("<$0.01");
  });
});

const view = (over: Partial<ThreadView> = {}): ThreadView => ({
  threadId: "thr_a",
  title: "a",
  eligible: true,
  status: "idle",
  hasPendingInteraction: false,
  compactOn: true,
  setting: 2,
  lines,
  line: 150_000,
  context: 300_000,
  window: 1_000_000,
  model: "claude-opus-5-5",
  lifetime: "1h",
  callsPerMessage: 3,
  callsMeasured: true,
  postCompaction: 40_000,
  postMeasured: false,
  priceOrigin: "bundled",
  rates: { w: 1, r: 1, o: 1 },
  deadline: 10 * 60_000,
  compactionDue: false,
  compactSkipped: false,
  compactedAt: null,
  canCompactNow: true,
  waiting: false,
  warmDue: false,
  warmSkipped: false,
  nextWarmAt: null,
  counts: { commands: 0, subagents: 0, children: 0, messages: 0 },
  ...over,
});

describe("the chip", () => {
  it("shows an icon alone when off, the line when on, a countdown when due, paused on a question", () => {
    expect(chipText(view({ compactOn: false }), 0)).toBe("");
    expect(chipText(view(), 0)).toBe("≥ 150k");
    expect(chipText(view({ compactionDue: true }), 0)).toBe("10m");
    expect(chipText(view({ hasPendingInteraction: true }), 0)).toBe("paused");
  });

  it("names the status in the popover", () => {
    expect(statusText(view({ status: "active" }), 0)).toBe("working");
    expect(statusText(view({ compactionDue: true }), 0)).toBe("compacting in 10m");
    expect(statusText(view({ context: 10 }), 0)).toBe("idle, under the line");
  });

  it("counts what a thread waits on without naming any of it", () => {
    expect(countsText({ commands: 2, subagents: 0, children: 1, messages: 1 })).toBe("2 background commands, 1 child thread and 1 queued message");
  });
});
