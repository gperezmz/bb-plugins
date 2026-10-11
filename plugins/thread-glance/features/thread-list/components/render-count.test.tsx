// @vitest-environment jsdom
// AC30: a thread event costs one record and one row's render, rows off screen
// are not mounted, and no row asks the server for anything.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { resetRowRenderCounts, rowRenderCounts } from "../testing/fake-host";
import { flush, mount, useListHarness } from "../testing/harness";

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const thread = (index: number) =>
  makeThread({ id: `t${index}`, title: `Thread ${index}`, createdAt: NOW - (index + 5) * MIN, updatedAt: NOW - (index + 5) * MIN, latestAttentionAt: NOW - (index + 5) * MIN });

const VIEWPORT = 800;
let viewport: number;
beforeEach(() => {
  viewport = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: VIEWPORT });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: viewport });
});

const mountedRows = () => document.querySelectorAll("[data-card]").length;

describe("AC30: the list at 2,000 threads", () => {
  const threads = Array.from({ length: 2_000 }, (_, index) => thread(index));
  // Active holds them all, in this order.
  const order = threads.map((each) => each.id);

  it("mounts only the rows in or near the view, with spacers standing in for the rest", async () => {
    await mount({ threads, server: { order, settings: { inactiveShelf: false } } });
    expect(mountedRows()).toBeGreaterThan(5);
    expect(mountedRows()).toBeLessThan(60);
    const spacer = document.querySelector("[data-sidebar-windowed-nav]")!;
    const nav = spacer.getAttribute("data-sidebar-windowed-nav")!.split(" ");
    expect(nav.length).toBeGreaterThan(1_900);
    expect(nav[0]).toMatch(/^t\d+:proj_a$/);
  });

  it("renders one row when a thread finishes a turn", async () => {
    const m = await mount({ threads, server: { order, settings: { inactiveShelf: false } } });
    resetRowRenderCounts();
    act(() => m.host.updateThread("t3", { status: "idle", isUnread: true, indicator: "unread-success", latestAttentionAt: NOW + MIN }));
    await flush();
    expect([...rowRenderCounts().keys()]).toEqual(["t3"]);
  });

  it("renders only that row for a record that arrives alone", async () => {
    const m = await mount({ threads, server: { order, settings: { inactiveShelf: false } } });
    resetRowRenderCounts();
    await act(async () => {
      await m.server.setRow("t7", { settledAt: null, settledKind: null, parkedAt: null, snoozeUntil: null, snoozedAt: null, activeOverride: true });
    });
    await flush();
    expect([...rowRenderCounts().keys()]).toEqual(["t7"]);
    expect(rowRenderCounts().get("t7")).toBe(1);
  });

  it("makes no request from a row: the server hears only sync, the auto-settle pass and the window's one ports read, however long the list stays open", async () => {
    const m = await mount({ threads, server: { order, settings: { inactiveShelf: false } } });
    await flush();
    const heard = () => m.server.calls.map((call) => call.method);
    expect(new Set(heard())).toEqual(new Set(["sync", "ports", "runAutoSettle"]));
    expect(heard().filter((method) => method === "ports")).toHaveLength(1);
    const before = heard();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    await act(async () => void (await vi.advanceTimersByTimeAsync(10 * MIN)));
    await flush();
    expect(heard()).toEqual(before);
  });
});
