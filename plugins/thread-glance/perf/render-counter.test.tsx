// @vitest-environment jsdom
// The harness's render count, checked against renders known another way: a
// remount draws every row, group header and the list header once, and every
// time a row renders it calls bb's `useSidebarThreadShortcut` once, which the
// fake host counts.
import "./harness/render-counter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { CHANNELS } from "@/shared/contract";
import { counterAttached, startCounting, stopCounting } from "./harness/render-counter";
import { mountList, serverState } from "./harness/fake-host";
import { openList, settle } from "./harness/jsdom-run";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

const ids = (root: ParentNode, selector: string, attribute: string) =>
  [...root.querySelectorAll(selector)].map((node) => node.closest(`[${attribute}]`)?.getAttribute(attribute) ?? node.getAttribute(attribute));

describe("the render count", () => {
  it("reads React's commits", () => {
    expect(counterAttached()).toBe(true);
  });

  it("reports every row, group header and the list header once on a remount", async () => {
    const list = generateList({ size: 50 });
    const { host, app, slot } = await openList(list);
    slot.unmount();
    host.resetCounts();
    startCounting();
    const again = mountList(app, serverState());
    await settle(5);
    const count = stopCounting();
    const rows = ids(again.container, "[data-sidebar-thread-id]", "data-sidebar-thread-id");
    const groups = ids(again.container, '[data-sidebar="group-label"]', "data-sidebar-visibility-group");
    expect(rows.length).toBeGreaterThan(20);
    expect(groups.length).toBe(4);
    expect(count.rows).toBe(rows.length);
    expect([...count.rowIds.keys()].sort()).toEqual([...rows].sort());
    expect(Object.fromEntries(count.groupHeaders)).toEqual(Object.fromEntries(groups.map((group) => [group, 1])));
    expect(count.listHeader).toBe(1);
    expect(count.rows).toBe(host.hookCalls.useSidebarThreadShortcut);
  });

  it("reports exactly the rows that rendered when bb updates one thread", async () => {
    const list = generateList({ size: 50 });
    const { host, slot } = await openList(list);
    const mounted = slot.container.querySelectorAll("[data-sidebar-thread-id]").length;
    host.resetCounts();
    startCounting();
    await act(async () => host.updateThread(list.threads[0]!.id, { title: "Renamed", displayTitle: "Renamed" }));
    await settle(2);
    const count = stopCounting();
    expect(count.rows).toBeGreaterThan(0);
    expect(count.rows).toBe(host.hookCalls.useSidebarThreadShortcut);
    expect(count.rowIds.size).toBeLessThanOrEqual(mounted);
  });

  it("reports one row and no header when a stamp redraws one row", async () => {
    const list = generateList({ size: 50 });
    const { host, slot } = await openList(list);
    const threadId = slot.container.querySelector("[data-sidebar-thread-id]")!.getAttribute("data-sidebar-thread-id")!;
    host.updateThread(threadId, { status: "active", runtimeStatus: "active" });
    await settle(2);
    host.resetCounts();
    startCounting();
    await slot.emitRealtime(CHANNELS.stamps, { kind: "startedAt", threadIds: [threadId], value: Date.now() - 5.5 * 60_000 });
    await settle(2);
    const count = stopCounting();
    expect(count.rows).toBe(host.hookCalls.useSidebarThreadShortcut);
    expect([...count.rowIds.keys()]).toContain(threadId);
    expect(count.groupHeaders.size).toBe(0);
    expect(count.listHeader).toBe(0);
  });
});
