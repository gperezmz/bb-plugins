import { describe, expect, it } from "vitest";
import { bannerOf, chipSentence, chipText, countsText, entryText, nextWarmText, statusLine, statusText, warmSwitchFlippable, type ThreadView } from "@/src/core/view";
import { costText, formatUsd, fractionOf, settingAt, settingForText, splitText, stepSetting } from "./bar";

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
  windowKnown: true,
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
  keptWarm: true,
  warmSetting: "switched",
  treeTop: { threadId: "thr_1", title: "Build the page" },
  warmPlanned: false,
  warmSkipped: false,
  nextWarmAt: null,
  warmNoPrice: false,
  counts: { threads: 0, commands: 0, subagents: 0, queued: 0, scheduled: 0 },
  decision: null,
  transcriptUnreadable: null,
  ...over,
});

describe("the chip", () => {
  it("shows an icon alone when off, the line when on, a countdown when due, paused on a question", () => {
    expect(chipText(view({ compactOn: false }), 0)).toBe("");
    expect(chipText(view(), 0)).toBe("≥ 150k");
    expect(chipText(view({ compactionDue: true }), 0)).toBe("10m");
    expect(chipText(view({ hasPendingInteraction: true }), 0)).toBe("paused");
  });

  it("says on hover whether the thread is kept warm while it waits, whatever the chip's text", () => {
    expect(chipText(view({ compactOn: false, keptWarm: true }), 0)).toBe("");
    expect(chipSentence(view(), 0)).toMatch(/cold\. While it waits, its cache is kept warm\.$/);
    expect(chipSentence(view({ keptWarm: false }), 0)).toMatch(/While it waits, its cache is not kept warm\.$/);
    expect(chipSentence(view({ keptWarm: false, warmSetting: "never" }), 0)).toMatch(/Keep-warms are off in Settings\.$/);
  });

  it("names the status in the popover", () => {
    expect(statusText(view({ status: "active" }), 0)).toBe("working");
    expect(statusText(view({ compactionDue: true }), 0)).toBe("compacting in 10m");
    expect(statusText(view({ context: 10 }), 0)).toBe("idle, under the line");
  });

  it("counts what a thread waits on without naming any of it", () => {
    expect(countsText({ threads: 1, commands: 2, subagents: 0, queued: 1, scheduled: 0 })).toBe("1 thread, 2 commands and 1 queued message");
    expect(countsText({ threads: 2, commands: 0, subagents: 1, queued: 0, scheduled: 3 })).toBe("2 threads, 1 subagent and 3 scheduled messages");
    expect(countsText({ threads: 0, commands: 1, subagents: 0, queued: 0, scheduled: 0 })).toBe("1 command");
  });
});

describe("the banner", () => {
  const waiting = (over: Partial<ThreadView> = {}) => view({ waiting: true, counts: { threads: 2, commands: 1, subagents: 0, queued: 0, scheduled: 0 }, ...over });

  it("says in one line what is about to happen, with its buttons", () => {
    expect(bannerOf(view({ compactionDue: true }), 0)).toEqual({ text: "Compacting in 10m, before the cache goes cold", actions: ["skip-compaction", "compact-now"] });
    expect(bannerOf(view({ compactSkipped: true }), 0)).toEqual({ text: "Skipped until this thread next runs", actions: ["undo-compaction"] });
    expect(bannerOf(waiting({ warmPlanned: true }), 0)).toEqual({ text: "Waiting on 2 threads and 1 command, keeping cache warm", actions: ["skip-warm"] });
    expect(bannerOf(waiting(), 0)).toEqual({ text: "Waiting on 2 threads and 1 command, letting cache go cold", actions: [] });
    expect(bannerOf(waiting({ warmSkipped: true }), 0)).toEqual({ text: "Skipped for this wait", actions: ["undo-warm"] });
    expect(bannerOf(waiting({ warmNoPrice: true }), 0)).toEqual({ text: "Waiting on 2 threads and 1 command, not keeping cache warm: this model has no price", actions: [] });
  });

  it("says a waiting tree is not kept warm, with Keep warm, when its switch is off", () => {
    for (const warmSetting of ["every", "switched"] as const) {
      expect(bannerOf(waiting({ keptWarm: false, warmSetting }), 0)).toEqual({ text: "Waiting on 2 threads and 1 command, not keeping cache warm", actions: ["keep-warm"] });
    }
  });

  it("says keep-warms are off in Settings under Never, with no button, whatever was skipped or planned", () => {
    for (const over of [{}, { warmSkipped: true }, { warmPlanned: true }]) {
      expect(bannerOf(waiting({ keptWarm: false, warmSetting: "never", ...over }), 0)).toEqual({ text: "Waiting on 2 threads and 1 command, keep-warms are off in Settings", actions: [] });
    }
  });

  it("shows nothing when there is nothing to say", () => {
    expect(bannerOf(view(), 0)).toBeNull();
    expect(bannerOf(view({ keptWarm: false }), 0)).toBeNull();
    expect(bannerOf(waiting({ warmPlanned: true, status: "active" }), 0)).toBeNull();
    expect(bannerOf(view({ compactionDue: true, hasPendingInteraction: true }), 0)).toBeNull();
  });

  it("never uses Cache Keeper's own words but for the setting's", () => {
    const texts = [
      bannerOf(waiting({ warmPlanned: true }), 0),
      bannerOf(waiting(), 0),
      bannerOf(waiting({ keptWarm: false }), 0),
      bannerOf(waiting({ warmSkipped: true }), 0),
      bannerOf(view({ compactionDue: true }), 0),
      bannerOf(view({ compactSkipped: true }), 0),
    ].map((b) => b!.text);
    for (const t of texts) expect(t).not.toMatch(/keep-warm|check-in|family|tree|report|cost stop/i);
  });
});

describe("keep warm while waiting", () => {
  it("can be flipped in the popover only on a tree top, and not under Never", () => {
    expect(warmSwitchFlippable(view({ threadId: "thr_1" }))).toBe(true);
    expect(warmSwitchFlippable(view({ threadId: "thr_2" }))).toBe(false);
    expect(warmSwitchFlippable(view({ threadId: "thr_1", warmSetting: "never" }))).toBe(false);
  });

  it("reads off on the page for a waiting thread whose tree is not kept warm", () => {
    expect(nextWarmText(view({ keptWarm: false, nextWarmAt: 5 * 60_000 }), 0)).toBe("off");
    expect(nextWarmText(view({ nextWarmAt: 5 * 60_000 }), 0)).toBe("in 5m");
    expect(nextWarmText(view(), 0)).toBe("–");
  });
});

describe("page entries", () => {
  it("names each send the way the page lists it", () => {
    expect(entryText("keep-warm", {})).toBe("Kept warm");
    expect(entryText("keep-warm", { threads: ["a"] })).toBe("Kept warm");
    expect(entryText("keep-warm", { threads: ["a", "b", "c"] })).toBe("Kept warm, 3 threads");
    expect(entryText("keep-warm", { threads: ["a"], folded: ["b0vq"] })).toBe("Kept warm, checked b0vq");
    expect(entryText("keep-warm", { threads: ["a", "b", "c"], folded: ["b0vq"] })).toBe("Kept warm, 3 threads, checked b0vq");
    expect(entryText("check-in", { tasks: [{ id: "b0vq" }, { id: "c1xx" }] })).toBe("Checked b0vq and c1xx");
    expect(entryText("compaction", { contextBefore: 300_000, contextAfter: 12_000 })).toBe("Compacted 300k → 12k");
  });

  it("marks a keep-warm or check-in shown at its forecast as an estimate, and never a compaction", () => {
    expect(costText(0.1234, true, "keep-warm")).toEqual({ text: "≈$0.12", estimate: true });
    expect(costText(0.1234, false, "keep-warm")).toEqual({ text: "$0.12", estimate: false });
    expect(costText(0.5, true, "compaction")).toEqual({ text: "$0.50", estimate: false });
    expect(costText(null, true, "check-in")).toEqual({ text: "–", estimate: false });
  });

  it("says how an entry's cost was split between threads", () => {
    const titles: Record<string, string> = { p: "Parent", c: "Build the page" };
    expect(splitText({ c: 0.02, p: 0.031 }, (id) => titles[id]!)).toBe("Parent $0.03, Build the page $0.02");
    expect(splitText(undefined, (id) => id)).toBeNull();
  });
});

describe("the popover's status line", () => {
  it("starts each side with a capital, whatever the status, and changes nothing after its first letter", () => {
    const now = 3 * 60 * 60_000;
    const statuses: [Partial<ThreadView>, string][] = [
      [{ status: "active", context: null }, "Now unknown · Working"],
      [{ hasPendingInteraction: true }, "Now 300k · Waiting on your answer"],
      [{ compactionDue: true, deadline: now + 3 * 60_000 }, "Now 300k · Compacting in 3m"],
      [{ compactedAt: now - 2 * 60 * 60_000 }, "Now 300k · Compacted 2h ago"],
      [{ compactSkipped: true }, "Now 300k · Skipped until this thread next runs"],
      [{ waiting: true }, "Now 300k · Waiting on background work"],
      [{ line: null }, "Now 300k · Idle, no line"],
      [{ line: 400_000 }, "Now 300k · Idle, under the line"],
      [{}, "Now 300k · Idle"],
    ];
    for (const [over, line] of statuses) {
      expect(statusLine(view(over), now)).toBe(line);
      const [left, right] = line.split(" · ");
      const lower = statusText(view(over), now);
      expect(right).toBe(lower.charAt(0).toUpperCase() + lower.slice(1));
      expect(left!.slice(1)).toBe(`ow ${over.context === null ? "unknown" : "300k"}`);
    }
  });
});

describe("a thread with no line", () => {
  it("never says a thread with no line is under it, or shows ≥ never", () => {
    const never = Array.from({ length: 10 }, () => null);
    expect(statusText(view({ line: null }), 0)).toBe("idle, no line");
    expect(chipText(view({ line: null }), 0)).toBe("no line");
    expect(chipSentence(view({ line: null, rates: null }), 0)).toContain("no price yet");
    expect(chipSentence(view({ line: null, lines: never }), 0)).toContain("at any setting");
    expect(chipSentence(view({ line: null }), 0)).toContain("at this setting");
  });

  it("says, while the window is unknown, that the line is set once the first turn ends, and never that the model has no price", () => {
    const unknown = { windowKnown: false, window: 0, line: null, lines: Array.from({ length: 10 }, () => null) };
    for (const rates of [null, { w: 1, r: 1, o: 1 }]) {
      expect(chipSentence(view({ ...unknown, rates }), 0)).toBe(
        "Compact when idle is on. Its line is set once this thread's first turn ends. While it waits, its cache is kept warm.",
      );
    }
    expect(chipText(view(unknown), 0)).toBe("no line");
    expect(chipSentence(view({ ...unknown, compactOn: false }), 0)).toMatch(/^Compact when idle is off\. Click to switch it on/);
  });
});
