import { describe, expect, it } from "vitest";
import { ICON_NAMES } from "@/components/ui/icon";
import { failedUnread, finishedUnread, makeThread, T0, working } from "../testing/fixtures";
import {
  computeState,
  FLAG_GLYPHS,
  isDoneUnseen,
  isUnread,
  pluginStatusWins,
  STATE_ICON_NAMES,
  threadFlags,
  type StateInputs,
} from "./state";
import { COUNTER_ICON_NAMES, ROW_ICON_NAMES } from "../icons";

const quiet: StateInputs = { unread: false, hasDraft: false, scheduledAt: null, now: T0 };

function stateOf(overrides: Parameters<typeof makeThread>[0], inputs: Partial<StateInputs> = {}) {
  return computeState(makeThread(overrides), { ...quiet, ...inputs });
}

describe("computeState (first match wins)", () => {
  it("1 waits-on-you outranks everything", () => {
    const state = stateOf({ id: "t", hasPendingInteraction: true, ...working, status: "error" });
    expect(state).toMatchObject({ kind: "waits-on-you", glyph: { icon: "CircleQuestion", tone: "attention" } });
  });
  it("2 failed while status is error, read or not", () => {
    expect(stateOf({ id: "t", status: "error" }).glyph).toMatchObject({ icon: "CircleX", tone: "destructive" });
    expect(stateOf({ id: "t", status: "error" }, { unread: true }).kind).toBe("failed");
  });
  it("3 queue-failed", () => {
    expect(stateOf({ id: "t", queuedWork: "failed" }).glyph).toMatchObject({
      icon: "AlertTriangle",
      tone: "destructive",
    });
  });
  it("4 offline only for waiting-for-host", () => {
    const state = stateOf({ id: "t", status: "active", runtimeStatus: "waiting-for-host" });
    expect(state).toMatchObject({ kind: "offline", label: "Machine offline", glyph: { icon: "CloudOff", tone: "attention" } });
  });
  it.each([
    ["provisioning", "Setting up"],
    ["starting", "Working"],
    ["active", "Working"],
    ["stopping", "Stopping"],
    ["host-reconnecting", "Reconnecting"],
  ])("5 working for %s, labelled %s", (runtimeStatus, label) => {
    const state = stateOf({ id: "t", status: "active", runtimeStatus: runtimeStatus as never });
    expect(state).toMatchObject({ kind: "working", label, glyph: { icon: "Loading", spin: true } });
  });
  it("5 working with a draft shows Edit with shine; plan mode and goals as bb", () => {
    expect(stateOf({ id: "t", ...working }, { hasDraft: true }).glyph).toMatchObject({ icon: "Edit", shine: true });
    expect(stateOf({ id: "t", ...working, activity: { planMode: 1 } }).glyph.icon).toBe("ListTodo");
    expect(stateOf({ id: "t", ...working, activity: { goals: 1 } }).glyph.icon).toBe("Target");
  });
  it.each([
    ["planMode", "ListTodo"],
    ["goals", "Target"],
    ["workflows", "Workflow"],
    ["backgroundAgents", "UserRoundPlus"],
    ["backgroundCommands", "Terminal"],
  ])("6 background %s draws %s", (field, icon) => {
    const state = stateOf({ id: "t", activity: { [field]: 1 } });
    expect(state).toMatchObject({ kind: "background", glyph: { icon, shine: true } });
  });
  it("6 background follows bb's order when several are set", () => {
    expect(stateOf({ id: "t", activity: { workflows: 3, goals: 1 } }).glyph.icon).toBe("Target");
  });
  it("7 scheduled while the send time is in the future", () => {
    const state = stateOf({ id: "t", queuedWork: "waiting" }, { scheduledAt: T0 + 1000 });
    expect(state).toMatchObject({ kind: "scheduled", sendAt: T0 + 1000, glyph: { icon: "Calendar" } });
  });
  it("8 queued once the send time passed, or with no schedule", () => {
    expect(stateOf({ id: "t", queuedWork: "waiting" }, { scheduledAt: T0 - 1 }).glyph.icon).toBe("Clock");
    expect(stateOf({ id: "t", queuedWork: "waiting" }).kind).toBe("queued");
  });
  it("9 unread, 10 draft, 11 idle", () => {
    expect(stateOf({ id: "t" }, { unread: true }).glyph.icon).toBe("dot");
    expect(stateOf({ id: "t" }, { hasDraft: true })).toMatchObject({ kind: "draft", glyph: { icon: "Edit" } });
    expect(stateOf({ id: "t" })).toMatchObject({ kind: "idle", glyph: { icon: "ring" } });
  });
  it("only idle draws the ring", () => {
    const others = [
      stateOf({ id: "t", hasPendingInteraction: true }),
      stateOf({ id: "t", status: "error" }),
      stateOf({ id: "t", queuedWork: "failed" }),
      stateOf({ id: "t", runtimeStatus: "waiting-for-host" }),
      stateOf({ id: "t", ...working }),
      stateOf({ id: "t", activity: { workflows: 1 } }),
      stateOf({ id: "t", queuedWork: "waiting" }, { scheduledAt: T0 + 5 }),
      stateOf({ id: "t", queuedWork: "waiting" }),
      stateOf({ id: "t" }, { unread: true }),
      stateOf({ id: "t" }, { hasDraft: true }),
    ];
    expect(others.filter((state) => state.glyph.icon === "ring").map((state) => state.kind)).toEqual([]);
  });
  it("unknown values fall back as documented", () => {
    expect(stateOf({ id: "t", status: "weird" as never }).kind).toBe("idle");
    expect(stateOf({ id: "t", status: "active", runtimeStatus: "weird" as never }).kind).toBe("working");
    expect(stateOf({ id: "t", queuedWork: "weird" as never }).kind).toBe("idle");
    expect(stateOf({ id: "t", status: "pending", runtimeStatus: "pending" }).kind).toBe("idle");
  });
  it("every state has its own label", () => {
    const labels = new Set([
      stateOf({ id: "t", hasPendingInteraction: true }).label,
      stateOf({ id: "t", status: "error" }).label,
      stateOf({ id: "t", queuedWork: "failed" }).label,
      stateOf({ id: "t", runtimeStatus: "waiting-for-host" }).label,
      stateOf({ id: "t", ...working }).label,
      stateOf({ id: "t", activity: { workflows: 1 } }).label,
      stateOf({ id: "t", queuedWork: "waiting" }, { scheduledAt: T0 + 5 }).label,
      stateOf({ id: "t", queuedWork: "waiting" }).label,
      stateOf({ id: "t" }, { unread: true }).label,
      stateOf({ id: "t" }, { hasDraft: true }).label,
      stateOf({ id: "t" }).label,
    ]);
    expect(labels.size).toBe(11);
  });
});

describe("plugin row status", () => {
  const status = { icon: "Zap", label: "Custom" };
  it("never replaces waits-on-you, failed or the plain spinner", () => {
    expect(pluginStatusWins(stateOf({ id: "t", hasPendingInteraction: true }), status)).toBe(false);
    expect(pluginStatusWins(stateOf({ id: "t", status: "error" }), status)).toBe(false);
    expect(pluginStatusWins(stateOf({ id: "t", ...working }), status)).toBe(false);
  });
  it("replaces every other glyph", () => {
    expect(pluginStatusWins(stateOf({ id: "t", ...working }, { hasDraft: true }), status)).toBe(true);
    expect(pluginStatusWins(stateOf({ id: "t", queuedWork: "waiting" }), status)).toBe(true);
    expect(pluginStatusWins(stateOf({ id: "t" }), status)).toBe(true);
    expect(pluginStatusWins(stateOf({ id: "t" }), null)).toBe(false);
  });
});

describe("unread", () => {
  const context = { activeThreadId: null, finishedAt: {}, seenAt: {} };
  it("roots follow bb's rule: finished since last read", () => {
    expect(isUnread(makeThread({ id: "r", ...finishedUnread }), context)).toBe(true);
    expect(isUnread(makeThread({ id: "r" }), context)).toBe(false);
    expect(isUnread(makeThread({ id: "r", ...finishedUnread, ...working }), context)).toBe(false);
    expect(isUnread(makeThread({ id: "r", ...finishedUnread, lastReadAt: null }), context)).toBe(true);
  });
  it("a failed child is unread by bb's rule", () => {
    expect(isUnread(makeThread({ id: "c", parentThreadId: "r", ...failedUnread }), context)).toBe(true);
  });
  it("a child finished after it was last read or seen is done-unseen", () => {
    const child = makeThread({ id: "c", parentThreadId: "r", lastReadAt: T0 });
    expect(isDoneUnseen(child, { ...context, finishedAt: { c: T0 + 5 } })).toBe(true);
    expect(isDoneUnseen(child, { ...context, finishedAt: { c: T0 + 5 }, seenAt: { c: T0 + 6 } })).toBe(false);
    expect(isDoneUnseen(child, { ...context, finishedAt: { c: T0 - 5 } })).toBe(false);
    expect(isDoneUnseen(child, { ...context, finishedAt: { c: T0 + 5 }, activeThreadId: "c" })).toBe(false);
    expect(isDoneUnseen({ ...child, ...working }, { ...context, finishedAt: { c: T0 + 5 } })).toBe(false);
  });
  it("roots are never done-unseen: their finish already bumps attention", () => {
    expect(isDoneUnseen(makeThread({ id: "r" }), { ...context, finishedAt: { r: T0 + 5 } })).toBe(false);
  });
});

describe("flags", () => {
  it("are independent of the first-match state", () => {
    const flags = threadFlags(makeThread({ id: "t", hasPendingInteraction: true, ...working }), false);
    expect([...flags].sort()).toEqual(["waits-on-you", "working"]);
  });
  it("unread-failed needs both error and unread", () => {
    expect(threadFlags(makeThread({ id: "t", status: "error" }), false).has("unread-failed")).toBe(false);
    expect(threadFlags(makeThread({ id: "t", status: "error" }), true).has("unread-failed")).toBe(true);
  });
});

describe("icon names", () => {
  it("every glyph name used is a host icon name", () => {
    const used = new Set([
      ...STATE_ICON_NAMES,
      ...Object.values(FLAG_GLYPHS)
        .map((glyph) => glyph.icon)
        .filter((icon): icon is string => icon !== "dot" && icon !== "ring"),
      ...ROW_ICON_NAMES,
      ...COUNTER_ICON_NAMES,
    ]);
    const host = new Set<string>(ICON_NAMES);
    expect([...used].filter((name) => !host.has(name))).toEqual([]);
  });
});
