// @vitest-environment jsdom
// Group by worktree: root threads that share a bb worktree sit under its
// branch inside their project's group under the Project sort, fold per
// device, and move by drag or Alt+Arrow, which reorders the manual order.
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeThread, titleOf } from "@/testing/fixtures";
import { installRowBoxes, rowY } from "../testing/dom-layout";
import { flush, mount, useListHarness } from "../testing/harness";

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const at = (minutesAgo: number) => ({ createdAt: NOW - minutesAgo * MIN, updatedAt: NOW - minutesAgo * MIN, latestAttentionAt: NOW - minutesAgo * MIN });
const worktree = (environmentId: string, branchName: string) => ({ environment: { id: environmentId, branchName, isWorktree: true } });

let removeBoxes: () => void;
beforeEach(() => {
  removeBoxes = installRowBoxes();
});
afterEach(() => removeBoxes());

const threads = () => [
  makeThread({ id: "a1", title: "A1", projectId: "proj_a", ...worktree("env_x", "feat/x"), ...at(60) }),
  makeThread({ id: "a2", title: "A2", projectId: "proj_a", ...at(50) }),
  makeThread({ id: "a3", title: "A3", projectId: "proj_a", ...worktree("env_x", "feat/x"), ...at(40) }),
  makeThread({ id: "a4", title: "A4", projectId: "proj_a", ...worktree("env_y", "feat/y"), ...at(30) }),
  makeThread({ id: "a5", title: "A5", projectId: "proj_a", ...worktree("env_y", "feat/y"), ...at(20) }),
  makeThread({ id: "b1", title: "B1", projectId: "proj_b", ...at(10) }),
];
const order = ["a1", "a2", "a3", "a4", "a5", "b1"];

/** A worktree group's header, by its environment id. */
const groupHeader = (environmentId: string) => document.querySelector<HTMLElement>(`[data-group-key="worktree:${environmentId}"]`)!;
const sortSelect = () => screen.getByRole("combobox", { name: "Sort Active" }) as HTMLSelectElement;
const groupButton = () => screen.queryByRole("button", { name: "Group by worktree" });

function rowTitles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => titleOf(row));
}
/** The branch of each worktree group, in order. */
function worktreeGroups(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-worktree-group]")].map((header) => header.textContent!.trim());
}

async function projectSort(scenario: Parameters<typeof mount>[0]) {
  const m = await mount(scenario);
  fireEvent.change(sortSelect(), { target: { value: "project" } });
  await flush();
  return m;
}

describe("AC1: Group by worktree groups root threads that share a worktree under its branch", () => {
  it("is off by default, and its button is offered only under the Project sort", async () => {
    await mount({ threads: threads(), server: { order } });
    expect(groupButton()).toBeNull();
    fireEvent.change(sortSelect(), { target: { value: "project" } });
    await flush();
    expect(groupButton()?.getAttribute("aria-pressed")).toBe("false");
    expect(worktreeGroups()).toEqual([]);
    fireEvent.change(sortSelect(), { target: { value: "activity" } });
    await flush();
    expect(groupButton()).toBeNull();
  });

  it("groups the threads of a worktree under its branch, where its first thread sits, and leaves the rest", async () => {
    const m = await projectSort({ threads: threads(), server: { order } });
    await act(async () => {
      fireEvent.click(groupButton()!);
    });
    await flush();
    expect(m.server.calls.filter((call) => call.method === "writeSettings").map((call) => call.input)).toEqual([{ patch: { groupByWorktree: true } }]);
    expect(groupButton()?.getAttribute("aria-pressed")).toBe("true");
    expect(worktreeGroups()).toEqual(["feat/x2", "feat/y2"]);
    expect(rowTitles()).toEqual(["A1", "A3", "A2", "A4", "A5", "B1"]);
    await act(async () => {
      fireEvent.click(groupButton()!);
    });
    await flush();
    expect(worktreeGroups()).toEqual([]);
    expect(rowTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "B1"]);
  });

  it("follows the setting from another window, such as the settings page or bb thread-glance prefs", async () => {
    const m = await projectSort({ threads: threads(), server: { order } });
    await act(async () => m.server.setSettings({ groupByWorktree: true }));
    await flush();
    expect(worktreeGroups()).toEqual(["feat/x2", "feat/y2"]);
  });
});

describe("AC2: a group collapses, remembered on the device, and shows its most urgent mark", () => {
  it("hides its threads, keeps the open one and is still collapsed after a reload", async () => {
    const first = await projectSort({ threads: threads(), server: { order, settings: { groupByWorktree: true } }, activeThreadId: "a3" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse feat/x worktree group" }));
    await flush();
    expect(rowTitles()).toEqual(["A3", "A2", "A4", "A5", "B1"]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse feat/y worktree group" }));
    await flush();
    expect(rowTitles()).toEqual(["A3", "A2", "B1"]);
    first.view.unmount();
    await mount({ threads: threads(), server: { order, settings: { groupByWorktree: true } } });
    expect(screen.getByRole("button", { name: "Expand feat/x worktree group" })).toBeTruthy();
    expect(rowTitles()).toEqual(["A2", "B1"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand feat/x worktree group" }));
    await flush();
    expect(rowTitles()).toEqual(["A1", "A3", "A2", "B1"]);
  });

  it("shows the mark of a thread that needs you or failed on a collapsed group's header, and none while it is open", async () => {
    const asking = threads().map((thread) => (thread.id === "a3" ? { ...thread, hasPendingInteraction: true, indicator: "waiting-for-input" as const } : thread));
    const m = await projectSort({ threads: asking, server: { order, settings: { groupByWorktree: true } } });
    const header = () => groupHeader("env_x");
    expect(header().querySelector("[data-urgency]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse feat/x worktree group" }));
    await flush();
    expect(header().querySelector("[data-urgency]")?.getAttribute("data-urgency")).toBe("needs-you");
    act(() => m.host.updateThread("a1", { indicator: "unread-error" }));
    await flush();
    expect(header().querySelector("[data-urgency]")?.getAttribute("data-urgency")).toBe("failed");
    fireEvent.click(screen.getByRole("button", { name: "Expand feat/x worktree group" }));
    await flush();
    expect(header().querySelector("[data-urgency]")).toBeNull();
  });
});

describe("AC2 and AC3: a group reorders by drag or Alt+Arrow, which moves its threads in the manual order", () => {
  const reorderCalls = (m: Awaited<ReturnType<typeof mount>>) => m.server.calls.filter((call) => call.method === "reorder");
  const move = (y: number) => fireEvent.pointerMove(window, { clientX: 10, clientY: y, pointerType: "mouse" });

  it("moves a group below another group by drag, and every window follows the order written", async () => {
    const m = await projectSort({ threads: threads(), server: { order, settings: { groupByWorktree: true } } });
    // Document order: project header, feat/x header, A1, A3, A2, feat/y header, A4, A5, B1.
    fireEvent.pointerDown(groupHeader("env_x"), { clientX: 10, clientY: rowY(1), button: 0, pointerType: "mouse" });
    move(rowY(1) + 8);
    move(rowY(5));
    await flush();
    move(rowY(6));
    await flush();
    expect(worktreeGroups()).toEqual(["feat/y2", "feat/x2"]);
    expect(rowTitles()).toEqual(["A2", "A4", "A5", "A1", "A3", "B1"]);
    await act(async () => {
      fireEvent.pointerUp(window);
    });
    await flush();
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["a2", "a4", "a5", "a1", "a3"] }]);
    expect(m.server.order).toEqual(["a2", "a4", "a5", "a1", "a3", "b1"]);
    // A reload on this or another device reads the same order.
    m.view.unmount();
    await mount({ threads: threads(), server: m.server });
    expect(rowTitles()).toEqual(["A2", "A4", "A5", "A1", "A3", "B1"]);
  });

  it("moves a group one slot with Alt+Arrow and announces it", async () => {
    const m = await projectSort({ threads: threads(), server: { order, settings: { groupByWorktree: true } } });
    const header = groupHeader("env_x").querySelector("button")!;
    await act(async () => {
      fireEvent.keyDown(header, { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(screen.getByRole("status").textContent).toContain("feat/x moved to 2 of 3 in Active");
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["a2", "a1", "a3", "a4", "a5"] }]);
    expect(rowTitles()).toEqual(["A2", "A1", "A3", "A4", "A5", "B1"]);
  });

  it("moves a thread inside its group only among that group's threads", async () => {
    const m = await projectSort({ threads: threads(), server: { order, settings: { groupByWorktree: true } } });
    await act(async () => {
      fireEvent.keyDown(document.querySelector<HTMLElement>('[data-row-id="a1"] a')!, { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["a3", "a1"] }]);
    expect(rowTitles()).toEqual(["A3", "A1", "A2", "A4", "A5", "B1"]);
  });
});
