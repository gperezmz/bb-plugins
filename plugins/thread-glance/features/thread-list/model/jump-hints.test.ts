import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_DELAY_MS, jumpLabel, trackHold } from "./jump-hints";

const key = (name: string, extra: Partial<Parameters<ReturnType<typeof trackHold>["keyDown"]>[0]> = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

describe("jump hints", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(mac = false) {
    const events: string[] = [];
    const hold = trackHold({ mac, show: () => events.push("show"), hide: () => events.push("hide") });
    return { events, hold };
  }

  it("shows after the modifier is held alone for 700 ms, and hides on release", () => {
    const { events, hold } = setup();
    hold.keyDown(key("Control", { ctrlKey: true }));
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["show"]);
    hold.keyUp({ key: "Control" });
    expect(events).toEqual(["show", "hide"]);
  });

  it.each([
    ["Shift joins", key("Control", { ctrlKey: true, shiftKey: true })],
    ["Alt joins", key("Control", { ctrlKey: true, altKey: true })],
    ["Meta joins", key("Control", { ctrlKey: true, metaKey: true })],
  ])("never shows when %s", (_, event) => {
    const { events, hold } = setup();
    hold.keyDown(event);
    vi.advanceTimersByTime(2_000);
    expect(events).toEqual([]);
  });

  it("cancels a pending hold on another key or on blur, and hides shown hints on either", () => {
    const { events, hold } = setup();
    hold.keyDown(key("Control", { ctrlKey: true }));
    hold.keyDown(key("a", { ctrlKey: true }));
    vi.advanceTimersByTime(2_000);
    expect(events).toEqual([]);
    hold.keyDown(key("Control", { ctrlKey: true }));
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    hold.keyDown(key("3", { ctrlKey: true }));
    expect(events).toEqual(["show", "hide"]);
    hold.keyDown(key("Control", { ctrlKey: true }));
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    hold.blur();
    expect(events).toEqual(["show", "hide", "show", "hide"]);
  });

  it("uses ⌘ on a Mac and ignores Control there", () => {
    const { events, hold } = setup(true);
    hold.keyDown(key("Control", { ctrlKey: true }));
    vi.advanceTimersByTime(2_000);
    expect(events).toEqual([]);
    hold.keyDown(key("Meta", { metaKey: true }));
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    expect(events).toEqual(["show"]);
    expect(jumpLabel(2, true)).toBe("⌘ 2");
    expect(jumpLabel(2, false)).toBe("Ctrl + 2");
  });
});
