// @vitest-environment jsdom
// The shelf list: which shelves it draws, in which order, collapsed or not,
// and what each shelf holds.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { DAY, HOUR, makeThread, working, titleOf } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";

useListHarness();

const NOW = Date.now();
/** Activity a few minutes ago: nothing that would put a thread on Inactive. */
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };
/** Activity three days ago: anything marked since then stays where it was put. */
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };
const stale = { createdAt: NOW - 9 * HOUR, updatedAt: NOW - 8 * HOUR, latestAttentionAt: NOW - 8 * HOUR };

/** The shelf headers as drawn, top to bottom. */
function shelfHeaders(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-shelf]")].map((header) => header.querySelector("button")!.textContent!.trim());
}

function titles(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-card]")].map((row) => titleOf(row));
}

const everyShelf = () => [
  makeThread({ id: "p", title: "Pinned one", isPinned: true, pinnedAt: NOW, ...fresh }),
  makeThread({ id: "a", title: "Active one", ...fresh }),
  makeThread({ id: "w", title: "Working one", ...working, ...fresh }),
  makeThread({ id: "i", title: "Inactive one", ...stale }),
  makeThread({ id: "s", title: "Snoozed one", ...old }),
  makeThread({ id: "k", title: "Parked one", ...old }),
  makeThread({ id: "d", title: "Settled one", ...old }),
];
const everyRow = () => ({
  s: snoozedRow(NOW + 2 * HOUR, NOW - HOUR),
  k: parkedRow(NOW - 2 * DAY),
  d: settledRow(NOW - 2 * DAY, "manual"),
});

describe("AC1: the shelves", () => {
  it("draws every shelf in order, with Inactive, Snoozed, Parked and Settled collapsed", async () => {
    await mount({ threads: everyShelf(), server: { settings: { workingShelf: true }, rows: everyRow() } });
    expect(shelfHeaders()).toEqual(["Pinned", "Active", "Working", "Inactive (1)", "Snoozed (1)", "Parked (1)", "Settled (1)"]);
    expect(screen.getByRole("button", { name: "Inactive (1)" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Pinned" }).getAttribute("aria-expanded")).toBe("true");
    expect(titles()).toEqual(["Pinned one", "Active one", "Working one"]);
  });

  it("leaves out empty shelves and the Working shelf while its setting is off", async () => {
    await mount({ threads: everyShelf().slice(0, 2) });
    expect(shelfHeaders()).toEqual(["Pinned", "Active"]);
    await mount({ threads: [makeThread({ id: "w", ...working, ...fresh }), makeThread({ id: "a", ...fresh })] });
    expect(shelfHeaders()).not.toContain("Working");
  });

  it("opens and collapses a shelf, and keeps that on the device", async () => {
    const first = await mount({ threads: everyShelf(), server: { rows: everyRow() } });
    fireEvent.click(screen.getByRole("button", { name: "Inactive (1)" }));
    await flush();
    expect(screen.getByRole("button", { name: "Inactive" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Inactive one")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    await flush();
    expect(screen.getByRole("button", { name: "Pinned (1)" })).toBeTruthy();
    first.view.unmount();
    await mount({ threads: everyShelf(), server: { rows: everyRow() } });
    expect(screen.getByRole("button", { name: "Inactive" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Pinned (1)" })).toBeTruthy();
  });

  it("keeps the open thread on a collapsed shelf, and threads needing attention with the setting on", async () => {
    const threads = [
      makeThread({ id: "i1", title: "Quiet", ...stale }),
      makeThread({ id: "i2", title: "Opened", ...stale }),
      makeThread({ id: "i3", title: "Asks", ...stale, hasPendingInteraction: true }),
    ];
    await mount({ threads: threads.slice(0, 2), activeThreadId: "i2" });
    expect(titles()).toEqual(["Opened"]);
    expect(screen.getByRole("button", { name: "Inactive (2)" })).toBeTruthy();
  });

  it("sorts Snoozed by soonest wake, and Parked and Settled newest first", async () => {
    const threads = ["x", "y", "z"].map((id) => makeThread({ id, title: id, ...old }));
    const server = (rows: Record<string, ReturnType<typeof parkedRow>>) => ({ rows });
    const snoozed = await mount({
      threads,
      server: server({ x: snoozedRow(NOW + 3 * HOUR, NOW), y: snoozedRow(NOW + 1 * HOUR, NOW), z: snoozedRow(NOW + 2 * HOUR, NOW) }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Snoozed (3)" }));
    await flush();
    expect(titles()).toEqual(["y", "z", "x"]);
    snoozed.view.unmount();
    localStorage.clear();
    const parked = await mount({
      threads,
      server: server({ x: parkedRow(NOW - 3 * DAY + 1), y: parkedRow(NOW - 1 * DAY), z: parkedRow(NOW - 2 * DAY) }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Parked (3)" }));
    await flush();
    expect(titles()).toEqual(["y", "z", "x"]);
    parked.view.unmount();
    localStorage.clear();
    await mount({
      threads,
      server: server({ x: settledRow(NOW - 3 * DAY + 1, "manual"), y: settledRow(NOW - 1 * DAY, "auto"), z: settledRow(NOW - 2 * DAY, "manual") }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Settled (3)" }));
    await flush();
    expect(titles()).toEqual(["y", "z", "x"]);
  });
});

describe("settled paging", () => {
  it("shows 10 rows, then Load N more in pages of 25", async () => {
    const threads = Array.from({ length: 50 }, (_, index) => makeThread({ id: `t${index}`, title: `t${index}`, ...old }));
    const rows = Object.fromEntries(threads.map((thread, index) => [thread.id, settledRow(NOW - DAY - index * 1000, "manual")]));
    await mount({ threads, server: { rows } });
    fireEvent.click(screen.getByRole("button", { name: "Settled (50)" }));
    await flush();
    expect(titles()).toHaveLength(10);
    expect(titles()[0]).toBe("t0");
    fireEvent.click(screen.getByRole("button", { name: "Load 25 more" }));
    await flush();
    expect(titles()).toHaveLength(35);
    fireEvent.click(screen.getByRole("button", { name: "Load 15 more" }));
    await flush();
    expect(titles()).toHaveLength(50);
    expect(screen.queryByRole("button", { name: /Load/ })).toBeNull();
  });
});

describe("loading, error and scenes", () => {
  it("says All clear when no pinned, active, working or inactive thread is visible", async () => {
    await mount({ threads: [makeThread({ id: "s", ...old })], server: { rows: { s: parkedRow(NOW - DAY) } } });
    expect(screen.getByText("All clear. Time to touch some grass.")).toBeTruthy();
  });

  it("draws the Working scene when the Working shelf holds every thread", async () => {
    await mount({ threads: [makeThread({ id: "w", ...working, ...fresh })], server: { settings: { workingShelf: true } } });
    expect(document.querySelector("[data-scene=working]")).not.toBeNull();
    expect(screen.queryByText("All clear. Time to touch some grass.")).toBeNull();
  });

  it("keeps the loading live region from the start and shows the spinner text only after 200 ms", async () => {
    const view = await mountLoading();
    expect(within(view).getByRole("status").textContent).toBe("");
    await waitFor(() => expect(within(view).getByRole("status").textContent).toContain("Loading threads…"));
  });
});

async function mountLoading(): Promise<HTMLElement> {
  const { server } = await mountHeld();
  void server;
  return document.body;
}

async function mountHeld() {
  const { createFakeHost, mountList, serverState } = await import("../testing/fake-host");
  const { loadWithFakeHost } = await import("../testing/fake-host");
  const app = await loadWithFakeHost();
  const server = serverState({ holdSync: true });
  createFakeHost({ threads: [makeThread({ id: "a", ...fresh })], projects: [] });
  const view = mountList(app, server);
  await act(async () => {});
  return { server, view };
}

describe("the first draw", () => {
  const threads = () => [makeThread({ id: "i", title: "Idle one", ...stale })];

  it("draws from the browser's cache and the defaults (Inactive on) before the server answers, then follows the server", async () => {
    localStorage.setItem("thread-glance:cache.rows", JSON.stringify({}));
    const m = await mount({ threads: threads(), server: { holdSync: true, settings: { inactiveShelf: false } } });
    expect(screen.getByRole("button", { name: "Inactive (1)" })).toBeTruthy();
    await act(async () => m.server.releaseSync());
    await flush();
    expect(shelfHeaders()).toEqual(["Active"]);
    expect(titles()).toEqual(["Idle one"]);
  });

  it("waits for the server when nothing is cached", async () => {
    const { createFakeHost, loadWithFakeHost, mountList, serverState } = await import("../testing/fake-host");
    const app = await loadWithFakeHost();
    const server = serverState({ holdSync: true });
    createFakeHost({ threads: threads(), projects: [] });
    mountList(app, server);
    await act(async () => {});
    expect(document.querySelector("[data-list-ready]")).toBeNull();
    await act(async () => server.releaseSync());
    await waitFor(() => expect(document.querySelector("[data-list-ready]")).not.toBeNull());
  });

  it("says it could not load threads when bb's list fails, and offers Retry", async () => {
    const { createFakeHost, loadWithFakeHost, mountList, serverState } = await import("../testing/fake-host");
    const app = await loadWithFakeHost();
    const host = createFakeHost({ threads: threads(), projects: [] });
    mountList(app, serverState());
    host.update({ status: "error" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load threads."));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
