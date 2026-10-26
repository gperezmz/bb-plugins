import { describe, expect, it } from "vitest";
import { ageLabel, foldDraft, statusSlot, withElapsed, type StatusInput } from "./status-slot";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const base: StatusInput = {
  hasPendingInteraction: false,
  queuedWork: "none",
  indicator: "none",
  indicatorLabel: null,
  hasDraft: false,
  rowStatus: null,
  workingSince: null,
  lastActivityAt: NOW - 3 * 60 * MIN,
  now: NOW,
};
const slot = (patch: Partial<StatusInput>) => statusSlot({ ...base, ...patch });

describe("the age", () => {
  it("reads now, minutes, hours, days up to a week, then weeks", () => {
    expect(ageLabel(NOW - 30_000, NOW)).toBe("now");
    expect(ageLabel(NOW - 5 * MIN, NOW)).toBe("5m");
    expect(ageLabel(NOW - 3 * 60 * MIN, NOW)).toBe("3h");
    expect(ageLabel(NOW - 6 * 24 * 60 * MIN, NOW)).toBe("6d");
    expect(ageLabel(NOW - 7 * 24 * 60 * MIN, NOW)).toBe("1w");
    expect(ageLabel(NOW - 20 * 24 * 60 * MIN, NOW)).toBe("2w");
  });

  it("shows when nothing else speaks", () => {
    expect(slot({})).toMatchObject({ kind: "age", label: "3h", tone: "muted", glyph: null });
  });
});

describe("the precedence", () => {
  it("puts a pending question first, over a failed queued message and the indicator", () => {
    expect(slot({ hasPendingInteraction: true, queuedWork: "failed", indicator: "unread-error" })).toMatchObject({ kind: "needs-you", label: "Needs you" });
  });

  it("puts a failed or waiting queued message over the indicator", () => {
    expect(slot({ queuedWork: "failed", indicator: "runtime" }).label).toBe("Send failed");
    expect(slot({ queuedWork: "waiting", indicator: "runtime" }).label).toBe("Queued");
    expect(slot({ queuedWork: "waiting", indicator: "unread-error" }).label).toBe("Queued");
    expect(slot({ queuedWork: "waiting", hasPendingInteraction: true }).label).toBe("Needs you");
    expect(slot({ queuedWork: "waiting" }).label).toBe("Queued");
  });

  it("names each indicator", () => {
    const labels = (
      [
        "unread-error",
        "waiting-for-input",
        "unread-success",
        "runtime",
        "workflow",
        "background-agent",
        "background-command",
        "plan-mode",
        "goal",
        "draft",
        "working-draft",
      ] as const
    ).map((indicator) => slot({ indicator }).label);
    expect(labels).toEqual(["Failed", "Needs you", "Unread", "Working", "Workflow", "Agent", "Command", "Planning", "Goal", "Draft", "Drafting"]);
  });

  it("calls a monitor Monitoring by bb's label", () => {
    expect(slot({ indicator: "runtime", indicatorLabel: "Thread is monitoring" })).toMatchObject({ kind: "monitoring", label: "Monitoring" });
  });
});

describe("drafts", () => {
  it("reads Draft on an idle thread and Drafting · 2m while it works", () => {
    expect(slot({ hasDraft: true }).label).toBe("Draft");
    expect(slot({ hasDraft: true, indicator: "runtime", workingSince: NOW - 2 * MIN }).label).toBe("Drafting · 2m");
  });

  it("lets a failure, a question or an unread result keep its own status", () => {
    expect(foldDraft("unread-error", true)).toBe("unread-error");
    expect(foldDraft("waiting-for-input", true)).toBe("waiting-for-input");
    expect(foldDraft("unread-success", true)).toBe("unread-success");
  });
});

describe("the elapsed time", () => {
  it("is added to work labels from the first sight of the work, and not under a minute", () => {
    expect(slot({ indicator: "runtime", workingSince: NOW - 5 * MIN }).label).toBe("Working · 5m");
    expect(slot({ indicator: "workflow", workingSince: NOW - 90 * MIN }).label).toBe("Workflow · 1h");
    expect(slot({ indicator: "runtime", workingSince: NOW - 20_000 }).label).toBe("Working");
    expect(slot({ indicator: "runtime", workingSince: null }).label).toBe("Working");
    expect(slot({ indicator: "unread-error", workingSince: NOW - 5 * MIN }).label).toBe("Failed");
    expect(withElapsed("Goal", NOW - 2 * MIN, NOW)).toBe("Goal · 2m");
  });
});

describe("glyphs and tones", () => {
  it("gives each label its glyph and colour", () => {
    expect(slot({ indicator: "unread-error" })).toMatchObject({ tone: "failed", glyph: { kind: "icon", name: "CircleX" } });
    expect(slot({ hasPendingInteraction: true })).toMatchObject({ tone: "needs-you", glyph: { kind: "icon", name: "CircleQuestion" } });
    expect(slot({ indicator: "runtime" })).toMatchObject({ tone: "working", glyph: { kind: "icon", name: "Loading", spin: true } });
    expect(slot({ indicator: "plan-mode" })).toMatchObject({ tone: "working", glyph: { kind: "icon", shine: true } });
    expect(slot({ indicator: "draft" })).toMatchObject({ tone: "draft", glyph: { kind: "icon", name: "Edit" } });
    expect(slot({ indicator: "unread-success" })).toMatchObject({ tone: "unread", glyph: { kind: "dot" } });
  });
});

describe("a status another plugin set", () => {
  const sandbox = { icon: "Box", label: "Sandbox ready", tone: "success" } as const;

  it("takes the slot from an idle thread, an unread result and a draft, with the age beside its icon", () => {
    for (const patch of [{}, { indicator: "unread-success" as const }, { hasDraft: true }]) {
      expect(slot({ ...patch, rowStatus: sandbox })).toMatchObject({
        kind: "plugin",
        label: "3h",
        ariaLabel: "Sandbox ready",
        tone: "bb-success",
        glyph: { kind: "icon", name: "Box" },
      });
    }
  });

  it("gives each tone bb's colour, and a shimmer to running", () => {
    expect(slot({ rowStatus: { icon: "Box", label: "x" } })).toMatchObject({ tone: "muted", glyph: { name: "Box" } });
    expect(slot({ rowStatus: { icon: "Box", label: "x", tone: "error" } }).tone).toBe("bb-error");
    expect(slot({ rowStatus: { icon: "Box", label: "x", tone: "running" } })).toMatchObject({ tone: "bb-running", glyph: { shine: true } });
  });

  it("yields to a question, a failed or waiting queued message, work in flight and a failure", () => {
    expect(slot({ rowStatus: sandbox, hasPendingInteraction: true }).label).toBe("Needs you");
    expect(slot({ rowStatus: sandbox, queuedWork: "failed" }).label).toBe("Send failed");
    expect(slot({ rowStatus: sandbox, queuedWork: "waiting" }).label).toBe("Queued");
    expect(slot({ rowStatus: sandbox, indicator: "runtime" }).label).toBe("Working");
    expect(slot({ rowStatus: sandbox, indicator: "runtime", hasDraft: true }).label).toBe("Drafting");
    expect(slot({ rowStatus: sandbox, indicator: "workflow" }).label).toBe("Workflow");
    expect(slot({ rowStatus: sandbox, indicator: "unread-error" }).label).toBe("Failed");
    expect(slot({ rowStatus: sandbox, indicator: "waiting-for-input" }).label).toBe("Needs you");
  });
});
