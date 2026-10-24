// @vitest-environment jsdom
// The lifecycle commands: their toasts and Undo (AC5, AC6, AC8, AC9, AC10),
// the refusals of a busy thread (AC7), and the waiting settle of a busy tree
// (#333).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeRow, parkedRow, settledRow, snoozedRow, waitingSettleRow } from "@/shared/lifecycle";
import { busyRefusal, childNeedsYouRefusal, SETTLE_UNDO_GONE, SNOOZE_ENDED } from "@/shared/messages";
import { DAY, HOUR, makeThread, working } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { createLifecycleCommands, lifecycleHostOf } from "./lifecycle";
import { registerCard, SWEEP_MS } from "./sweep";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };

beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Server options with the Inactive shelf off, so a thread idle for days still starts on Active. */
const quiet = (options: Parameters<typeof mount>[0]["server"] = {}) => ({ settings: { inactiveShelf: false }, ...(options as object) });
/** Opens a card's clock menu, as a pointer press on its button does. */
const openClockMenu = async (title: string) => {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole("button", { name: `Snooze ${title}` }), { button: 0, ctrlKey: false });
  });
  return screen.getByRole("menu");
};
const chooseFromClockMenu = async (title: string, item: string | RegExp) => {
  const menu = await openClockMenu(title);
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
  });
  await flush();
};
const settleFromCard = async (title: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Settle ${title}` }));
  });
  await flush();
};
/** The window's clock reads `at` from here on; timers keep running. */
const setClock = (at: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
};
/** The text of a toast's description. */
const describing = (call: unknown[]): string => {
  const description = (call[1] as { description?: ReactNode }).description;
  return description === undefined ? "" : render(<div>{description}</div>).container.textContent!;
};
const toastCall = (title: string) => toasts.success.mock.calls.find((call) => call[0] === title)!;
const pressUndo = async (call: unknown[]) => {
  await act(async () => {
    await (call[1] as { action: { onClick(): unknown } }).action.onClick();
  });
  await flush();
};
const callsOf = (m: Awaited<ReturnType<typeof mount>>, method: string) => m.server.calls.filter((call) => call.method === method);
const shelfOfRow = (id: string) => document.querySelector(`[data-card][data-thread-id="${id}"]`)?.getAttribute("data-shelf-of");

describe("Snooze (AC5)", () => {
  it("snoozes with a toast that reads Thread snoozed, when it wakes and what was reclaimed, with Undo that lasts 10 s", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { note: "Agent session stopped" } });
    setClock(NOW);
    await chooseFromClockMenu("A", /^1 hour/);
    expect(callsOf(m, "snooze").map((call) => call.input)).toEqual([{ threadId: "a", until: NOW + HOUR }]);
    const call = toastCall("Thread snoozed");
    expect(describing(call)).toMatch(/^Wakes .*Agent session stopped$/);
    expect((call[1] as { duration: number }).duration).toBe(10_000);
    expect(screen.getByRole("button", { name: "Snoozed (1)" })).toBeTruthy();
    await pressUndo(call);
    expect(callsOf(m, "undoLifecycle")).toHaveLength(1);
    expect(shelfOfRow("a")).toBe("active");
  });

  it("keeps the default toast length when nothing was reclaimed", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    await chooseFromClockMenu("Thread a", /^1 hour/);
    expect("duration" in (toastCall("Thread snoozed")[1] as object)).toBe(false);
  });
});

describe("AC7: a busy thread", () => {
  it("offers only Settle on hover, and refuses Park and Snooze at once when this window sees it busy", async () => {
    await mount({ threads: [makeThread({ id: "a", title: "Busy one", ...working, ...fresh })] });
    expect(screen.queryByRole("button", { name: "Snooze Busy one" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settle Busy one" })).not.toBeNull();
    const call = vi.fn();
    const lifecycle = createLifecycleCommands(lifecycleHostOf({ call } as never, () => makeThread({ id: "a", title: "Busy one", ...working, ...fresh })));
    await lifecycle.park("a");
    await lifecycle.snooze("a", NOW + HOUR);
    expect(toasts.error.mock.calls.map((entry) => entry[0])).toEqual([busyRefusal("park", "Busy one"), busyRefusal("snooze", "Busy one")]);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses Settle at once for a thread with a question of its own", async () => {
    const call = vi.fn();
    const asking = makeThread({ id: "a", title: "Asking", hasPendingInteraction: true, ...fresh });
    await createLifecycleCommands(lifecycleHostOf({ call } as never, () => asking)).settle("a");
    expect(toasts.error).toHaveBeenCalledWith(busyRefusal("settle", "Asking"));
    expect(call).not.toHaveBeenCalled();
  });

  it("shows the server's refusal when the thread started a turn after the menu opened, and changes nothing", async () => {
    const text = busyRefusal("park", "A");
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { refuse: { park: text } } });
    await chooseFromClockMenu("A", "Park thread");
    expect(toasts.error).toHaveBeenCalledWith(text);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(m.server.rows.size).toBe(0);
    expect(shelfOfRow("a")).toBe("active");
  });
});

describe("a Settle of a busy tree waits (#333)", () => {
  const family = () => [
    makeThread({ id: "p", title: "Parent", ...fresh }),
    makeThread({ id: "c", title: "Child", parentThreadId: "p", ...working, ...fresh }),
  ];

  it("toasts that it waits, with Undo, without sweeping the card away, and the card shows the mark", async () => {
    const m = await mount({ threads: family(), server: { settleWaits: ["p"] } });
    await settleFromCard("Parent");
    expect(callsOf(m, "settle")).toHaveLength(1);
    const call = toastCall("Waiting to settle");
    expect(describing(call)).toBe("Settles once no thread in its tree is busy");
    expect(document.querySelector('[data-thread-id="p"] [data-waiting-settle]')).not.toBeNull();
    expect(shelfOfRow("p")).not.toBe("settled");
    // Waiting already, the card offers no Settle on hover, and Undo takes the wait back.
    expect(screen.queryByRole("button", { name: "Settle Parent" })).toBeNull();
    await pressUndo(call);
    expect(callsOf(m, "undoLifecycle")).toHaveLength(1);
    expect(document.querySelector('[data-thread-id="p"] [data-waiting-settle]')).toBeNull();
  });

  it("cancels from the card's mark, and the mark shows in a window that loads while it waits", async () => {
    const m = await mount({ threads: family(), server: { rows: { p: waitingSettleRow(NOW) } } });
    expect(document.querySelector('[data-thread-id="p"] [data-waiting-settle]')).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel settling Parent" }));
    });
    await flush();
    expect(callsOf(m, "cancelSettle").map((call) => call.input)).toEqual([{ threadId: "p" }]);
    expect(document.querySelector('[data-thread-id="p"] [data-waiting-settle]')).toBeNull();
    expect(shelfOfRow("p")).toBe("active");
  });
});

describe("Woke and Wake now (AC6)", () => {
  it("wakes a snoozed thread now, toasting with Undo that re-snoozes only while the old time is ahead", async () => {
    const m = await mount({
      threads: [makeThread({ id: "a", title: "A", ...old })],
      server: { rows: { a: snoozedRow(NOW + 2 * HOUR, NOW - HOUR) } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Snoozed (1)" }));
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wake thread now" }));
    });
    await flush();
    expect(callsOf(m, "wake")).toHaveLength(1);
    const call = toastCall("Thread woke up");
    await pressUndo(call);
    expect(callsOf(m, "undoLifecycle")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Snoozed" })).toBeTruthy();
    expect(shelfOfRow("a")).toBe("snoozed");
  });

  it("shows why Undo could not re-snooze", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...old })], server: { rows: { a: snoozedRow(NOW + 2 * HOUR, NOW - HOUR) } } });
    fireEvent.click(screen.getByRole("button", { name: "Snoozed (1)" }));
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wake thread now" }));
    });
    await flush();
    await m.server.setRow("a", activeRow());
    await pressUndo(toastCall("Thread woke up"));
    expect(toasts.error).toHaveBeenCalledWith("Changed since");
  });

  it("refuses Undo once the time the thread was snoozed until has passed", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...old })], server: { rows: { a: snoozedRow(NOW + 2 * HOUR, NOW - HOUR) } } });
    fireEvent.click(screen.getByRole("button", { name: "Snoozed (1)" }));
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wake thread now" }));
    });
    await flush();
    setClock(NOW + 3 * HOUR);
    await pressUndo(toastCall("Thread woke up"));
    expect(toasts.error).toHaveBeenCalledWith(SNOOZE_ENDED);
    expect(callsOf(m, "undoLifecycle")).toHaveLength(1);
    expect(shelfOfRow("a")).not.toBe("snoozed");
  });

  it("shows a woke thread in Active with a Woke label in two windows, and opening it clears the marker in both", async () => {
    const threads = [makeThread({ id: "a", title: "A", ...old })];
    const first = await mount({ threads, server: { rows: { a: snoozedRow(NOW - 60_000, NOW - HOUR) } } });
    const second = await mount({ threads, server: first.server });
    expect(screen.getAllByText("Woke")).toHaveLength(2);
    expect(shelfOfRow("a")).toBe("active");
    second.host.updateProps({ activeThreadId: "a" });
    await flush();
    await flush();
    await act(async () => {});
    await flush();
    expect(callsOf(first, "dismissWoke")).toHaveLength(1);
    expect(screen.queryAllByText("Woke")).toHaveLength(0);
    expect(first.server.rows.has("a")).toBe(false);
  });

  it("dismisses the marker from its button", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...old })], server: { rows: { a: snoozedRow(NOW - 60_000, NOW - HOUR) } } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss Woke marker" }));
    });
    await flush();
    expect(callsOf(m, "dismissWoke")).toHaveLength(1);
    expect(screen.queryByText("Woke")).toBeNull();
  });
});

describe("A child's question lifts its parent (#332)", () => {
  const family = (asking: boolean) => [
    makeThread({ id: "root", title: "Root", ...old }),
    makeThread({ id: "kid", title: "Kid", parentThreadId: "root", ...old }),
    makeThread({ id: "grandkid", title: "Grandkid", parentThreadId: "kid", ...old, hasPendingInteraction: asking }),
  ];

  it("brings a parked root back to Active while a grandchild asks, and parks it again, row untouched, after the answer", async () => {
    const row = parkedRow(NOW - HOUR);
    const m = await mount({ threads: family(true), server: { rows: { root: row } } });
    expect(shelfOfRow("root")).toBe("active");
    m.host.updateThread("grandkid", { hasPendingInteraction: false });
    await flush();
    expect(shelfOfRow("root")).toBeUndefined();
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeTruthy();
    expect(m.server.rows.get("root")).toEqual(row);
  });

  it("shows a snoozed root as woke with nothing to dismiss, and opening it asks the server for nothing", async () => {
    const m = await mount({ threads: family(true), server: { rows: { root: snoozedRow(NOW + 2 * HOUR, NOW - HOUR) } } });
    expect(shelfOfRow("root")).toBe("active");
    expect(screen.getAllByText("Woke")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Dismiss Woke marker" })).toBeNull();
    m.host.updateProps({ activeThreadId: "root" });
    await flush();
    await act(async () => {});
    await flush();
    expect(callsOf(m, "dismissWoke")).toHaveLength(0);
    expect(m.server.rows.has("root")).toBe(true);
  });

  it("refuses a Park or Settle pressed on the list's own card, saying a child needs you, and asks the server for nothing", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    const m = await mount({ threads: family(true), server: quiet() });
    await chooseFromClockMenu("Root", "Park thread");
    await settleFromCard("Root");
    expect(toasts.error.mock.calls.map((entry) => entry[0])).toEqual([childNeedsYouRefusal("park", "Grandkid"), childNeedsYouRefusal("settle", "Grandkid")]);
    expect(callsOf(m, "park")).toHaveLength(0);
    expect(callsOf(m, "settle")).toHaveLength(0);
    m.host.updateThread("grandkid", { hasPendingInteraction: false });
    await flush();
    toasts.error.mockClear();
    await chooseFromClockMenu("Root", "Park thread");
    expect(toasts.error).not.toHaveBeenCalled();
    expect(callsOf(m, "park")).toHaveLength(1);
  });

  it("refuses at once to park, snooze or settle the root, saying a child needs you, and asks the server for nothing", async () => {
    const call = vi.fn();
    const threads = family(true);
    const host = lifecycleHostOf(
      { call } as never,
      (id) => threads.find((thread) => thread.id === id) ?? null,
      (id) => (id === "root" ? "Grandkid" : null),
    );
    const lifecycle = createLifecycleCommands(host);
    await lifecycle.park("root");
    await lifecycle.snooze("root", NOW + HOUR);
    await lifecycle.settle("root");
    expect(toasts.error.mock.calls.map((entry) => entry[0])).toEqual([
      childNeedsYouRefusal("park", "Grandkid"),
      childNeedsYouRefusal("snooze", "Grandkid"),
      childNeedsYouRefusal("settle", "Grandkid"),
    ]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("Park and Resume (AC8)", () => {
  it("parks with a toast and Undo that resumes, and shows Waiting Nd", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet() });
    await chooseFromClockMenu("A", "Park thread");
    expect(toasts.success.mock.calls[0]![0]).toBe("Thread parked");
    expect(screen.getByRole("button", { name: "Parked (1)" })).toBeTruthy();
    await pressUndo(toastCall("Thread parked"));
    expect(callsOf(m, "resume")).toHaveLength(1);
    expect(toasts.success.mock.calls.map((call) => call[0])).toEqual(["Thread parked"]);
    expect(shelfOfRow("a")).toBe("active");
  });

  it("shows Waiting Nd on a parked row, whose Resume button returns it to Active with Undo that parks", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet({ rows: { a: parkedRow(NOW - 2 * DAY - HOUR) } }) });
    fireEvent.click(screen.getByRole("button", { name: "Parked (1)" }));
    await flush();
    expect(screen.getByText("Waiting 2d")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume thread" }));
    });
    await flush();
    expect(callsOf(m, "resume")).toHaveLength(1);
    const call = toastCall("Thread returned to Active");
    await pressUndo(call);
    expect(callsOf(m, "park")).toHaveLength(1);
  });
});

describe("Settle (AC9)", () => {
  it("plays the 520 ms sweep on a drawn card before it settles", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet() });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Settle A" }));
    });
    await flush();
    expect(document.querySelector("[data-sweep]")).not.toBeNull();
    expect(callsOf(m, "settle")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_MS);
    });
    await flush();
    expect(callsOf(m, "settle")).toHaveLength(1);
    expect(document.querySelector("[data-sweep]")).toBeNull();
  });

  it("settles at once under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet() });
    await settleFromCard("A");
    expect(document.querySelector("[data-sweep]")).toBeNull();
    expect(callsOf(m, "settle")).toHaveLength(1);
  });

  it("toasts for 4 s, or 10 s with a reclaim note, and Undo brings the thread back", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet() });
    await settleFromCard("A");
    const call = toastCall("Thread settled");
    expect((call[1] as { duration: number }).duration).toBe(4_000);
    await pressUndo(call);
    expect(callsOf(m, "undoSettle")).toHaveLength(1);
    expect(toasts.success).toHaveBeenCalledWith("Settling undone");
    expect(shelfOfRow("a")).toBe("active");
    m.view.unmount();
    toasts.success.mockClear();
    await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet({ note: "Agent session stopped" }) });
    await settleFromCard("A");
    expect((toastCall("Thread settled")[1] as { duration: number }).duration).toBe(10_000);
    expect(describing(toastCall("Thread settled"))).toBe("Agent session stopped");
  });

  it("says when the Settle can no longer be undone", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    const m = await mount({ threads: [makeThread({ id: "a", ...old })], server: quiet() });
    await settleFromCard("Thread a");
    m.server.refuse("undoSettle", SETTLE_UNDO_GONE);
    await pressUndo(toastCall("Thread settled"));
    expect(toasts.error).toHaveBeenCalledWith(SETTLE_UNDO_GONE);
  });

  it("shows the server's refusal when a child of the tree is working", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    const text = busyRefusal("settle", "Child");
    const m = await mount({ threads: [makeThread({ id: "p", title: "Parent", ...old })], server: quiet({ refuse: { settle: text } }) });
    await settleFromCard("Parent");
    expect(toasts.error).toHaveBeenCalledWith(text);
    expect(m.server.rows.size).toBe(0);
  });
});

describe("Un-settle (AC10)", () => {
  it("returns a settled thread to Active with Undo that settles it again", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...old })], server: quiet({ rows: { a: settledRow(NOW - DAY, "manual") } }) });
    fireEvent.click(screen.getByRole("button", { name: "Settled (1)" }));
    await flush();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Un-settle thread" }));
    });
    await flush();
    expect(callsOf(m, "unsettle")).toHaveLength(1);
    expect(shelfOfRow("a")).toBe("active");
    await pressUndo(toastCall("Thread returned to Active"));
    expect(callsOf(m, "settle")).toHaveLength(1);
  });
});

describe("a pinned thread with a row", () => {
  it("asks the server to clear the row once, and shows the thread on Pinned meanwhile", async () => {
    const m = await mount({
      threads: [makeThread({ id: "a", title: "A", isPinned: true, pinnedAt: NOW, ...old })],
      server: { rows: { a: settledRow(NOW - DAY, "manual") } },
    });
    await flush();
    expect(shelfOfRow("a")).toBe("pinned");
    expect(callsOf(m, "clearPinned")).toHaveLength(1);
    expect(m.server.rows.has("a")).toBe(false);
  });
});

describe("the list mounting", () => {
  it("asks the server for an auto-settle pass", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    expect(callsOf(m, "runAutoSettle")).toHaveLength(1);
  });
});

describe("commands outside the list", () => {
  const answer = { changes: [], reclaim: { stoppedRuntime: false, closedTerminals: 0, keptTerminals: 0 }, note: null };
  const rpc = () => {
    const call = vi.fn(async (method: string) => (method === "settle" ? { ...answer, undoToken: "u", undoUntil: 0 } : answer));
    return { call, client: { call } as never };
  };

  it("work for a menu action with the window's RPC client and a thread lookup", async () => {
    const { call, client } = rpc();
    const lifecycle = createLifecycleCommands(lifecycleHostOf(client));
    await lifecycle.park("a");
    expect(call).toHaveBeenCalledWith("park", { threadId: "a" });
    expect(toasts.success.mock.calls[0]![0]).toBe("Thread parked");
    const busy = createLifecycleCommands(lifecycleHostOf(client, () => ({ ...makeThread({ id: "b", title: "B", ...working }) })));
    await busy.snooze("b", NOW + HOUR);
    expect(toasts.error).toHaveBeenCalledWith(busyRefusal("snooze", "B"));
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("play the sweep on a card the sidebar draws, from any entry point", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { call, client } = rpc();
    const lifecycle = createLifecycleCommands(lifecycleHostOf(client));
    const gone = registerCard("a");
    const done = lifecycle.settle("a");
    await vi.advanceTimersByTimeAsync(SWEEP_MS - 1);
    expect(call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(call).toHaveBeenCalledWith("settle", { threadId: "a" });
    gone();
    const later = lifecycle.settle("a");
    await later;
    expect(call.mock.calls.filter(([method]) => method === "settle")).toHaveLength(2);
  });
});
