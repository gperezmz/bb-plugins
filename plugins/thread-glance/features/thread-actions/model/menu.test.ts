// The thread menu's actions for one thread: which apply, the Snooze list
// (AC5, menu half), and a Park chosen after the thread started a turn (AC7).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeThread, working } from "@/testing/fixtures";
import { createLifecycleCommands, lifecycleHostOf } from "@/features/thread-list";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { busyRefusal } from "@/shared/messages";
import { DEFAULT_SNOOZE_SHORTCUTS, TIME_PASSED_REASON } from "@/shared/snooze";
import {
  copyBranchAction,
  copyThreadIdAction,
  MACHINES_FAILED,
  parentAction,
  parkAction,
  PICK_CHOICE,
  projectAction,
  resumeAction,
  settleAction,
  snoozeAction,
  unsettleAction,
  wakeAction,
} from "./menu";
import { menuData, targetOf } from "./testing";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});

const idle = makeThread({ id: "t1", title: "Idle thread" });
// 2026-10-12 is a Monday.
const MONDAY_19H = new Date(2026, 9, 12, 19, 0, 0).getTime();

describe("which actions apply", () => {
  it("offers Snooze, Park thread and Settle on a thread that is not busy (AC20)", () => {
    const { data } = menuData([idle]);
    expect(snoozeAction(targetOf(idle), data)?.label).toBe("Snooze");
    expect(parkAction(targetOf(idle), data)?.label).toBe("Park thread");
    expect(settleAction(targetOf(idle), data)?.label).toBe("Settle");
    expect(wakeAction(targetOf(idle), data)).toBeNull();
    expect(resumeAction(targetOf(idle), data)).toBeNull();
    expect(unsettleAction(targetOf(idle), data)).toBeNull();
  });

  it("offers none of Snooze, Park and Settle on a busy thread", () => {
    const busy = makeThread({ id: "t1", ...working });
    const { data } = menuData([busy]);
    for (const build of [snoozeAction, parkAction, settleAction]) expect(build(targetOf(busy), data)).toBeNull();
  });

  it("offers none of them on a thread whose only sign of life is a running monitor", () => {
    const monitoring = makeThread({ id: "t1", runtimeStatus: "active" });
    const { data } = menuData([monitoring]);
    for (const build of [snoozeAction, parkAction, settleAction]) expect(build(targetOf(monitoring), data)).toBeNull();
  });

  it("offers Wake now, Park thread and Settle, not Snooze, on a snoozed thread that is not woke", () => {
    const now = Date.now();
    const { data } = menuData([idle], { now, rows: { t1: snoozedRow(now + 3_600_000, now - 1000) } });
    expect(wakeAction(targetOf(idle), data)?.label).toBe("Wake now");
    expect(snoozeAction(targetOf(idle), data)?.label).toBe("Snooze");
    expect(parkAction(targetOf(idle), data)).not.toBeNull();
  });

  it("offers Park thread and Settle but not Snooze on a woke thread", () => {
    const now = Date.now();
    const { data } = menuData([idle], { now, rows: { t1: snoozedRow(now - 1000, now - 3_600_000) } });
    expect(snoozeAction(targetOf(idle), data)).toBeNull();
    expect(wakeAction(targetOf(idle), data)).toBeNull();
    expect(parkAction(targetOf(idle), data)).not.toBeNull();
    expect(settleAction(targetOf(idle), data)).not.toBeNull();
  });

  it("offers Resume instead of Park thread on a parked thread", () => {
    const { data } = menuData([idle], { now: Date.now(), rows: { t1: parkedRow(Date.now() - 1000) } });
    expect(resumeAction(targetOf(idle), data)?.label).toBe("Resume");
    expect(parkAction(targetOf(idle), data)).toBeNull();
  });

  it("offers Un-settle instead of Settle on a settled thread", () => {
    const { data } = menuData([idle], { now: Date.now(), rows: { t1: settledRow(Date.now() - 1000, "manual") } });
    expect(unsettleAction(targetOf(idle), data)?.label).toBe("Un-settle");
    expect(settleAction(targetOf(idle), data)).toBeNull();
  });

  it("offers no lifecycle action on an archived thread", () => {
    const archived = makeThread({ id: "t1", isArchived: true, archivedAt: 5 });
    const { data } = menuData([archived]);
    for (const build of [snoozeAction, parkAction, settleAction]) expect(build(targetOf(archived), data)).toBeNull();
  });

  it("offers Copy branch only with a branch, and Copy thread ID always", () => {
    const withBranch = makeThread({ id: "t1", environment: { branchName: "feat/x" } });
    const without = makeThread({ id: "t2", environment: { branchName: null } });
    const { data, ports } = menuData([withBranch, without]);
    const copy = copyBranchAction(targetOf(withBranch), data)!;
    expect(copyBranchAction(targetOf(without), data)).toBeNull();
    void copy.run({ requestRename: () => {} });
    expect(ports.copy).toHaveBeenCalledWith("feat/x", "Branch copied");
    void copyThreadIdAction(targetOf(without), data)!.run({ requestRename: () => {} });
    expect(ports.copy).toHaveBeenCalledWith("t2", "Thread ID copied");
  });

  it("offers Parent… on every thread, opening its dialog", () => {
    const { data, ports } = menuData([idle]);
    void parentAction(targetOf(idle), data)!.run({ requestRename: () => {} });
    expect(ports.requestParent).toHaveBeenCalledWith("t1");
  });
});

describe("Snooze list (AC5)", () => {
  it("lists the presets of the setting, then Pick date & time…", () => {
    const { data } = menuData([idle], { presets: "30m, Later=2h, tomorrow@08:30", now: MONDAY_19H });
    const choices = snoozeAction(targetOf(idle), data)!.choices!;
    expect(choices.items.map((item) => item.label)).toEqual(["30 minutes", "Later", "Tomorrow morning", "Pick date & time…"]);
    expect(choices.items.at(-1)!.id).toBe(PICK_CHOICE);
  });

  it("uses the default presets when the setting is empty of valid ones", () => {
    const { data } = menuData([idle], { presets: "nonsense", now: MONDAY_19H });
    const labels = snoozeAction(targetOf(idle), data)!.choices!.items.map((item) => item.label);
    expect(labels).toEqual(["1 hour", "Wait refresh (5 hours)", "This evening", "Tomorrow morning", "Next week", "Pick date & time…"]);
  });

  it("disables a preset whose time has passed, and says why in the footnote", () => {
    const { data } = menuData([idle], { presets: DEFAULT_SNOOZE_SHORTCUTS, now: MONDAY_19H });
    const choices = snoozeAction(targetOf(idle), data)!.choices!;
    const disabled = choices.items.filter((item) => item.disabled).map((item) => item.label);
    expect(disabled).toEqual(["This evening"]);
    expect(choices.hint).toBe(TIME_PASSED_REASON);
  });

  it("has no footnote while every preset can be picked", () => {
    const { data } = menuData([idle], { presets: DEFAULT_SNOOZE_SHORTCUTS, now: new Date(2026, 9, 12, 8, 0).getTime() });
    expect(snoozeAction(targetOf(idle), data)!.choices!.hint).toBeUndefined();
  });

  it("snoozes until the next Monday 09:00 for Next week, on a Monday at 19:00", async () => {
    vi.useFakeTimers({ now: MONDAY_19H, toFake: ["Date"] });
    try {
      const { data, commands } = menuData([idle], { presets: DEFAULT_SNOOZE_SHORTCUTS, now: MONDAY_19H });
      const action = snoozeAction(targetOf(idle), data)!;
      const nextWeek = action.choices!.items.find((item) => item.label === "Next week")!;
      await action.run({ value: nextWeek.id, requestRename: () => {} });
      expect(commands.snooze).toHaveBeenCalledWith("t1", new Date(2026, 9, 19, 9, 0).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the picker for Pick date & time…", async () => {
    const { data, ports } = menuData([idle], { presets: DEFAULT_SNOOZE_SHORTCUTS });
    await snoozeAction(targetOf(idle), data)!.run({ value: PICK_CHOICE, requestRename: () => {} });
    expect(ports.requestSnoozePicker).toHaveBeenCalledWith("t1");
  });

  it("refuses a preset whose time passed while the menu was open", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 12, 17, 59).getTime(), toFake: ["Date"] });
    try {
      const { data, commands, ports } = menuData([idle], { presets: "evening@18:00", now: Date.now() });
      const action = snoozeAction(targetOf(idle), data)!;
      vi.setSystemTime(new Date(2026, 9, 12, 18, 1));
      await action.run({ value: action.choices!.items[0]!.id, requestRename: () => {} });
      expect(commands.snooze).not.toHaveBeenCalled();
      expect(ports.refuse).toHaveBeenCalledWith(TIME_PASSED_REASON);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a thread that starts a turn after its menu opened (AC7)", () => {
  it("shows the error and changes nothing when Park is chosen", async () => {
    const rpc = { call: vi.fn(async () => ({ changes: [], note: null })) };
    // The window sees the thread busy by the time Park runs; the menu was drawn when it was idle.
    const lookup = vi.fn(() => makeThread({ id: "t1", title: "Idle thread", ...working }));
    const commands = createLifecycleCommands(lifecycleHostOf(rpc as never, lookup));
    const { data } = menuData([idle]);
    const action = parkAction(targetOf(idle), { ...data, commands })!;

    await action.run({ requestRename: () => {} });

    expect(rpc.call).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(busyRefusal("park", "Idle thread"));
    expect(toasts.success).not.toHaveBeenCalled();
  });
});

describe("Project (AC22)", () => {
  const inAlpha = makeThread({ id: "t1" });

  it("is not offered for the personal project", () => {
    const personal = makeThread({ id: "t1", projectId: "proj_personal" });
    expect(projectAction(targetOf(personal), menuData([personal]).data)).toBeNull();
  });

  it("offers settings, rename, add local path and remove", () => {
    const action = projectAction(targetOf(inAlpha), menuData([inAlpha]).data)!;
    expect(action.choices!.items.map((item) => item.label)).toEqual([
      "Project settings",
      "Rename project",
      "Add local path",
      "Remove project",
    ]);
  });

  it("opens bb's settings page, and the rename, add-path and remove dialogs", async () => {
    const { data, ports } = menuData([inAlpha]);
    const action = projectAction(targetOf(inAlpha), data)!;
    const pick = (label: string) => action.choices!.items.find((item) => item.label === label)!.id;
    await action.run({ value: pick("Project settings"), requestRename: () => {} });
    expect(ports.openPage).toHaveBeenCalledWith("/projects/proj_a/settings");
    await action.run({ value: pick("Rename project"), requestRename: () => {} });
    await action.run({ value: pick("Add local path"), requestRename: () => {} });
    await action.run({ value: pick("Remove project"), requestRename: () => {} });
    expect(ports.requestProject.mock.calls).toEqual([
      ["rename", "proj_a"],
      ["add-path", "proj_a"],
      ["remove", "proj_a"],
    ]);
  });

  it("hides Add local path without machines", () => {
    const action = projectAction(targetOf(inAlpha), menuData([inAlpha], { machines: { count: 0 } }).data)!;
    expect(action.choices!.items.map((item) => item.label)).not.toContain("Add local path");
  });

  it("disables Add local path with 'Could not load machines' when the machines failed to load", () => {
    const action = projectAction(targetOf(inAlpha), menuData([inAlpha], { machines: "failed" }).data)!;
    const addPath = action.choices!.items.find((item) => item.label === "Add local path")!;
    expect(addPath.disabled).toBe(true);
    expect(action.choices!.hint).toBe(MACHINES_FAILED);
  });
});
