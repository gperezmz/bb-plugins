// @vitest-environment jsdom
// AC16: reordering by pointer and keyboard, and AC14's rule that a sort other
// than Manual order turns reordering off in Active while Pinned still moves.
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThread, PROJECTS, titleOf } from "@/testing/fixtures";
import { installRowBoxes, rowY } from "../testing/dom-layout";
import { flush, mount, useListHarness, type Mounted } from "../testing/harness";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const at = (minutesAgo: number) => ({ createdAt: NOW - minutesAgo * MIN, updatedAt: NOW - minutesAgo * MIN, latestAttentionAt: NOW - minutesAgo * MIN });

let removeBoxes: () => void;
beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
  removeBoxes = installRowBoxes();
});
afterEach(() => removeBoxes());

const abc = () => [makeThread({ id: "a", title: "A", ...at(30) }), makeThread({ id: "b", title: "B", ...at(20) }), makeThread({ id: "c", title: "C", ...at(10) })];

function rowTitles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => titleOf(row));
}

const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"] a`)!;

function press(id: string, init: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(rowEl(id), { clientX: 10, clientY: rowY(0), button: 0, pointerType: "mouse", ...init });
}
function move(x: number, y: number) {
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerType: "mouse" });
}

/** Releases the pointer and lets the write it starts finish. */
async function release() {
  await act(async () => {
    fireEvent.pointerUp(window);
  });
  await flush();
}

const reorderCalls = (m: Mounted) => m.server.calls.filter((call) => call.method === "reorder");

describe("AC16: reordering by pointer", () => {
  it("starts a drag after 6 px, more vertical than sideways, moves the row into the row it enters and writes on release", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("a");
    move(10, rowY(0) + 3);
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await flush();
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    move(10, rowY(2));
    await flush();
    expect(rowTitles()).toEqual(["B", "C", "A"]);
    expect(reorderCalls(m)).toHaveLength(0);
    await release();
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["b", "c", "a"] }]);
    expect(rowTitles()).toEqual(["B", "C", "A"]);
    expect(m.server.order).toEqual(["b", "c", "a"]);
  });

  it("is not a drag for the right button, touch, or a move that is mostly sideways or under 6 px", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    for (const [init, x, y] of [
      [{ button: 2 }, 10, rowY(1)],
      [{ pointerType: "touch" }, 10, rowY(1)],
      [{}, 40, rowY(0) + 10],
      [{}, 10, rowY(0) + 4],
    ] as const) {
      press("a", init);
      move(x, y);
      fireEvent.pointerUp(window);
      await flush();
      expect(rowTitles()).toEqual(["A", "B", "C"]);
    }
    expect(reorderCalls(m)).toHaveLength(0);
  });

  it("moves to the first or last slot over empty space", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("b");
    move(10, rowY(1) + 8);
    move(10, -50);
    await flush();
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    move(10, 9_999);
    await flush();
    expect(rowTitles()).toEqual(["A", "C", "B"]);
    await release();
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["a", "c", "b"] }]);
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    ["blur", () => fireEvent.blur(window)],
    ["resize", () => fireEvent.resize(window)],
    ["page hide", () => fireEvent(window, new Event("pagehide"))],
    ["a cancelled pointer", () => fireEvent.pointerCancel(window)],
  ])("abandons the drag on %s without writing, and the next click opens the row", async (_name, cancel) => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("a");
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await flush();
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    cancel();
    await flush();
    expect(rowTitles()).toEqual(["A", "B", "C"]);
    expect(reorderCalls(m)).toHaveLength(0);
    fireEvent.click(rowEl("a"));
    expect(m.view.navigateCalls).toEqual([{ method: "toThread", threadId: "a" }]);
  });

  it("abandons the drag when the tab is hidden", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("a");
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await flush();
    expect(rowTitles()).toEqual(["A", "B", "C"]);
    expect(reorderCalls(m)).toHaveLength(0);
  });

  it("swallows the click after a drop, once", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("a");
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await release();
    fireEvent.click(rowEl("a"));
    expect(m.view.navigateCalls).toEqual([]);
    fireEvent.click(rowEl("a"));
    expect(m.view.navigateCalls).toHaveLength(1);
  });

  it("cancels the drag when the dragged thread is deleted", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    press("a");
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await flush();
    act(() => m.host.update({ threads: m.host.state().threads.filter((thread) => thread.id !== "a") }));
    await flush();
    expect(rowTitles()).toEqual(["B", "C"]);
    await release();
    expect(reorderCalls(m)).toHaveLength(0);
  });

  it("shows the move while the write is out, then rolls it back when the write fails, and says so", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"], refuse: { reorder: "no" }, holdReorder: true } });
    press("a");
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await release();
    expect(reorderCalls(m)).toHaveLength(1);
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    await act(async () => m.server.releaseReorder());
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("Could not reorder Active thread");
    expect(rowTitles()).toEqual(["A", "B", "C"]);
  });

  it("moves a thread inside a group only among that group", async () => {
    const threads = [
      makeThread({ id: "a1", title: "A1", ...at(50) }),
      makeThread({ id: "b1", title: "B1", projectId: "proj_b", ...at(40) }),
      makeThread({ id: "a2", title: "A2", ...at(30) }),
      makeThread({ id: "a3", title: "A3", ...at(20) }),
    ];
    const m = await mount({ threads, projects: PROJECTS, server: { order: ["a1", "b1", "a2", "a3"] } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort Active" }), { target: { value: "project" } });
    await flush();
    expect(rowTitles()).toEqual(["A1", "A2", "A3", "B1"]);
    // Document order: group header, A1, A2, A3, B1. Drag A1 (index 1) past A3 (index 3) and onto B1 (index 4).
    fireEvent.pointerDown(rowEl("a1"), { clientX: 10, clientY: rowY(1), button: 0, pointerType: "mouse" });
    move(10, rowY(1) + 8);
    move(10, rowY(3));
    await flush();
    move(10, rowY(4));
    await flush();
    expect(rowTitles()).toEqual(["A2", "A3", "A1", "B1"]);
    await release();
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["a2", "a3", "a1"] }]);
  });
});

describe("AC16: reordering by keyboard", () => {
  it("moves a row with Alt+Arrow and announces its place, and that it is already first or last", async () => {
    const m = await mount({ threads: abc(), server: { order: ["a", "b", "c"] } });
    const announcer = screen.getByRole("status");
    fireEvent.keyDown(rowEl("a"), { key: "ArrowUp", altKey: true });
    expect(announcer.textContent).toContain("A is already first in Active");
    await act(async () => {
      fireEvent.keyDown(rowEl("a"), { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(announcer.textContent).toContain("A moved to 2 of 3 in Active");
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    expect(reorderCalls(m).map((call) => call.input)).toEqual([{ threadIds: ["b", "a", "c"] }]);
    await act(async () => {
      fireEvent.keyDown(rowEl("c"), { key: "ArrowDown", altKey: true });
    });
    expect(announcer.textContent).toContain("C is already last in Active");
  });

  it("moves a pinned row through bb's pin order and announces it in Pinned", async () => {
    const threads = [
      makeThread({ id: "p1", title: "P1", isPinned: true, pinnedAt: NOW, pinSortKey: "a", ...at(30) }),
      makeThread({ id: "p2", title: "P2", isPinned: true, pinnedAt: NOW, pinSortKey: "b", ...at(20) }),
      makeThread({ id: "p3", title: "P3", isPinned: true, pinnedAt: NOW, pinSortKey: "c", ...at(10) }),
    ];
    const m = await mount({ threads });
    await act(async () => {
      fireEvent.keyDown(rowEl("p1"), { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(screen.getByRole("status").textContent).toContain("P1 moved to 2 of 3 in Pinned");
    expect(m.host.sdkCalls.find((call) => call.method === "threads.reorderPinned")?.args).toEqual({
      threadId: "p1",
      previousThreadId: "p2",
      nextThreadId: "p3",
    });
    await flush();
    expect(rowTitles()).toEqual(["P2", "P1", "P3"]);
  });

  it("toasts when the pin order cannot be written", async () => {
    const threads = [
      makeThread({ id: "p1", title: "P1", isPinned: true, pinnedAt: NOW, pinSortKey: "a", ...at(30) }),
      makeThread({ id: "p2", title: "P2", isPinned: true, pinnedAt: NOW, pinSortKey: "b", ...at(20) }),
    ];
    await mount({ threads, failReorderPinned: true });
    await act(async () => {
      fireEvent.keyDown(rowEl("p1"), { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("Could not reorder pinned thread");
    expect(rowTitles()).toEqual(["P1", "P2"]);
  });
});

describe("AC14: reordering with another sort", () => {
  it("lets Pinned reorder but not Active under Recent activity", async () => {
    const threads = [
      makeThread({ id: "p1", title: "P1", isPinned: true, pinnedAt: NOW, pinSortKey: "a", ...at(30) }),
      makeThread({ id: "p2", title: "P2", isPinned: true, pinnedAt: NOW, pinSortKey: "b", ...at(20) }),
      makeThread({ id: "a", title: "A", ...at(15) }),
      makeThread({ id: "b", title: "B", ...at(10) }),
    ];
    const m = await mount({ threads, server: { order: ["a", "b"] } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort Active" }), { target: { value: "activity" } });
    await flush();
    // Active rows do not drag.
    fireEvent.pointerDown(rowEl("a"), { clientX: 10, clientY: rowY(2), button: 0, pointerType: "mouse" });
    move(10, rowY(2) + 8);
    move(10, rowY(3));
    await flush();
    await release();
    expect(reorderCalls(m)).toHaveLength(0);
    // Pinned rows do.
    fireEvent.pointerDown(rowEl("p1"), { clientX: 10, clientY: rowY(0), button: 0, pointerType: "mouse" });
    move(10, rowY(0) + 8);
    move(10, rowY(1));
    await flush();
    await release();
    expect(m.host.sdkCalls.some((call) => call.method === "threads.reorderPinned")).toBe(true);
  });
});
