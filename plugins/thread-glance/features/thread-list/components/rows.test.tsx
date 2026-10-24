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
import { readRowPlaces, slideRows } from "./reorder/slide";

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

  it("keeps focus when bb focuses the composer long after a double-click's first click", async () => {
    const composer = document.body.appendChild(document.createElement("textarea"));
    const m = await mount({ threads: [makeThread({ id: "a", title: "Old", ...fresh })] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    const input = screen.getByRole("textbox", { name: "Rename Old" });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 700))));
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("textbox", { name: "Rename Old" })).toBe(input);
    expect(m.host.sdkCalls.filter((call) => call.method === "threads.update")).toEqual([]);
    composer.remove();
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
    root.innerHTML = '<div data-shelf="active"></div><div data-row-id="a" data-row-header="shelf:active"></div><div data-row-id="b" data-row-header="shelf:active"></div>';
    document.body.append(root);
    return root;
  };
  // Places are read from layout, which jsdom does not do.
  const place = (root: HTMLElement, tops: Record<string, number>) => {
    for (const element of root.querySelectorAll<HTMLElement>("[data-row-id], [data-shelf], [data-group-key]")) {
      const key = element.dataset.rowId ?? element.dataset.groupKey ?? `shelf:${element.dataset.shelf}`;
      Object.defineProperty(element, "offsetTop", { configurable: true, value: tops[key]! });
    }
  };

  it("eases each row that moved under its header from where it was over 150 ms, and none under reduced motion", () => {
    const root = container();
    const animations: { id: string; keyframes: unknown; options: unknown }[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("[data-row-id]")) {
      element.animate = ((keyframes: unknown, options: unknown) => void animations.push({ id: element.dataset.rowId!, keyframes, options })) as never;
    }
    place(root, { "shelf:active": 0, a: 0, b: 100 });
    const before = readRowPlaces(root);
    place(root, { "shelf:active": 0, a: 100, b: 0 });
    slideRows(root, before, false);
    expect(animations.map((each) => each.id)).toEqual(["a", "b"]);
    expect(animations[0]!.options).toMatchObject({ duration: 150 });
    expect(animations[0]!.keyframes).toEqual([{ transform: "translateY(-100px)" }, { transform: "translateY(0)" }]);
    animations.length = 0;
    slideRows(root, before, true);
    expect(animations).toEqual([]);
    slideRows(root, readRowPlaces(root), false);
    expect(animations).toEqual([]);
    // The header carried both rows down by 200 px: nothing slides.
    place(root, { "shelf:active": 200, a: 200, b: 300 });
    slideRows(root, before, false);
    expect(animations).toEqual([]);
  });

  it("leaves a group's rows still when its header carries them", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-shelf="active"></div><div data-group-key="group:x"></div><div data-row-id="x1" data-row-header="group:x"></div>' +
      '<div data-group-key="group:y"></div><div data-row-id="y1" data-row-header="group:y"></div>';
    document.body.append(root);
    const animated: string[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("[data-row-id]")) element.animate = (() => void animated.push(element.dataset.rowId!)) as never;
    place(root, { "shelf:active": 0, "group:x": 28, x1: 56, "group:y": 128, y1: 156 });
    const before = readRowPlaces(root);
    place(root, { "shelf:active": 0, "group:x": 100, x1: 128, "group:y": 28, y1: 56 });
    slideRows(root, before, false);
    expect(animated).toEqual([]);
  });
});
