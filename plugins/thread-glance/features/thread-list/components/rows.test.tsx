// @vitest-environment jsdom
// The row seam: the open thread and a thread open in another pane, renaming in
// place, the Working shelf's icon, and the Working scene.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parkedRow } from "@/shared/lifecycle";
import { WORKING_LINES } from "../model/scenes";
import { DAY, makeThread, working } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { WorkingScene } from "./States";
import { slideRows } from "./reorder/slide";

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };

afterEach(() => vi.unstubAllGlobals());

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;

describe("the open thread", () => {
  it("highlights the open thread's row, tints a row open in another pane, and opens a thread on click", async () => {
    const threads = [makeThread({ id: "a", title: "A", ...fresh }), makeThread({ id: "b", title: "B", ...fresh }), makeThread({ id: "c", title: "C", ...fresh })];
    const m = await mount({ threads, activeThreadId: "a" });
    expect(card("a").hasAttribute("data-focused")).toBe(true);
    expect(card("a").className).toContain("tg-row-open");
    act(() =>
      m.host.update({
        splitLayout: {
          panes: [
            { paneId: "p1", rect: { x: 0, y: 0, width: 1, height: 1 }, threadId: "a", isFocused: true },
            { paneId: "p2", rect: { x: 1, y: 0, width: 1, height: 1 }, threadId: "b", isFocused: false },
          ],
        },
      }),
    );
    await flush();
    expect(card("b").hasAttribute("data-open-elsewhere")).toBe(true);
    expect(card("b").className).toContain("tg-row-elsewhere");
    expect(card("c").hasAttribute("data-open-elsewhere")).toBe(false);
    fireEvent.click(card("c").querySelector("a")!);
    expect(m.view.navigateCalls).toEqual([{ method: "toThread", threadId: "c" }]);
    expect(m.host.navigated).toBe(1);
    fireEvent.click(card("c").querySelector("a")!, { ctrlKey: true });
    expect(m.view.navigateCalls.at(-1)).toEqual({ method: "toThread", threadId: "c", options: { split: true } });
  });
});

describe("renaming in place", () => {
  it("saves a trimmed, changed title on Enter, and ignores an unchanged one", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "Old", ...fresh })] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    const input = screen.getByRole("textbox", { name: "Rename Old" });
    fireEvent.change(input, { target: { value: "  New title  " } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();
    expect(m.host.sdkCalls.filter((call) => call.method === "threads.update").map((call) => call.args)).toEqual([{ threadId: "a", title: "New title" }]);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();
    expect(m.host.sdkCalls.filter((call) => call.method === "threads.update")).toHaveLength(1);
  });

  it("cancels on Escape", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "Old", ...fresh })] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Different" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(m.host.sdkCalls.filter((call) => call.method === "threads.update")).toEqual([]);
  });

  it("keeps a row on its shelf until the rename ends", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY }), makeThread({ id: "b", ...fresh })], server: { settings: { inactiveShelf: false } } });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    await act(async () => m.server.setRow("a", parkedRow(NOW - 60_000)));
    await flush();
    expect(card("a").getAttribute("data-shelf-of")).toBe("active");
    expect(screen.queryByRole("button", { name: "Parked (1)" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    await flush();
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeTruthy();
  });
});

describe("the Working shelf", () => {
  it("spins its icon while it has work, whether or not motion is reduced", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    await mount({ threads: [makeThread({ id: "w", ...working, ...fresh }), makeThread({ id: "a", ...fresh })], server: { settings: { workingShelf: true } } });
    expect(document.querySelector("[data-shelf=working]")!.innerHTML).toContain("animate-spin");
    expect(document.querySelector("[data-shelf=active]")!.innerHTML).not.toContain("animate-spin");
  });
});

describe("the Working scene", () => {
  it("draws one of 18 lines on mount and never the line it drew last", () => {
    const seen: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const { container, unmount } = render(<WorkingScene />);
      seen.push(container.querySelector("p")!.textContent!);
      unmount();
    }
    for (let index = 1; index < seen.length; index += 1) expect(seen[index]).not.toBe(seen[index - 1]);
    expect(seen.every((line) => WORKING_LINES.includes(line))).toBe(true);
    expect(new Set(seen).size).toBeGreaterThan(5);
  });

  it("animates only without reduced motion", () => {
    const { container, unmount } = render(<WorkingScene />);
    expect(container.querySelector(".tg-typing")).not.toBeNull();
    unmount();
    cleanup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    const reduced = render(<WorkingScene />);
    expect(reduced.container.querySelector(".tg-typing")).toBeNull();
  });
});

describe("the slide of rows a reorder moves aside", () => {
  const container = () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-row-id="a"></div><div data-row-id="b"></div>';
    document.body.append(root);
    return root;
  };
  const place = (root: HTMLElement, tops: Record<string, number>) => {
    for (const element of root.querySelectorAll<HTMLElement>("[data-row-id]")) {
      element.getBoundingClientRect = () => ({ top: tops[element.dataset.rowId!]!, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    }
    root.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  };

  it("eases each row that moved from where it was over 150 ms, and none under reduced motion", () => {
    const root = container();
    const animations: { id: string; keyframes: unknown; options: unknown }[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("[data-row-id]")) {
      element.animate = ((keyframes: unknown, options: unknown) => void animations.push({ id: element.dataset.rowId!, keyframes, options })) as never;
    }
    place(root, { a: 100, b: 0 });
    slideRows(root, new Map([["a", 0], ["b", 100]]), false);
    expect(animations.map((each) => each.id)).toEqual(["a", "b"]);
    expect(animations[0]!.options).toMatchObject({ duration: 150 });
    expect(animations[0]!.keyframes).toEqual([{ transform: "translateY(-100px)" }, { transform: "translateY(0)" }]);
    animations.length = 0;
    slideRows(root, new Map([["a", 0], ["b", 100]]), true);
    expect(animations).toEqual([]);
    slideRows(root, new Map([["a", 100], ["b", 0]]), false);
    expect(animations).toEqual([]);
  });
});
