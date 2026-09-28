// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ThreadView } from "@/src/core/view";
import { view as viewOf } from "../model/view.test.helpers";
import { Chip } from "./Chip";

const view: ThreadView = viewOf({ threadId: "thr_a", treeTop: { threadId: "thr_a", title: "a" }, context: 312_000 });
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: async () => view }),
  useComposer: () => ({ scope: { kind: "thread", threadId: "thr_a" } }),
  useRealtime: () => {},
  useBbNavigate: () => ({ toThread: () => {} }),
  experimental_Icon: () => null,
}));

beforeAll(() => {
  // A desktop window with a fine pointer, as jsdom has none.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

async function chip(): Promise<HTMLElement> {
  render(<Chip />);
  return await screen.findByRole("button", { name: /^Cache Keeper:/ });
}

const popover = () => screen.getByRole("dialog");

describe("the composer chip's popover", () => {
  it("opened with a pointer, leaves every control in it unfocused", async () => {
    const trigger = await chip();
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });
    expect(screen.getByRole("switch", { name: "Keep warm while waiting" })).toBeTruthy();
    expect(document.activeElement).toBe(popover());
    expect(screen.queryAllByRole("switch").some((s) => s === document.activeElement)).toBe(false);
  });

  it("opened from the keyboard, puts focus on its first control", async () => {
    const trigger = await chip();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(trigger);
    });
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Keep warm while waiting" }));
  });

  it("opened from the keyboard after a pointer opened it before, still puts focus on its first control", async () => {
    const trigger = await chip();
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });
    await act(async () => fireEvent.keyDown(popover(), { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(trigger);
    });
    expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Keep warm while waiting" }));
  });
});
