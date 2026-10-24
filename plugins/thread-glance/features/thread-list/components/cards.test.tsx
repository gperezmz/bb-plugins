// @vitest-environment jsdom
// What the rows draw: the Full card, the Folded card, the Slim row, the Status
// slot (AC17), project colours and stripes (AC24), and the Failed label's
// colour (AC27).
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parkedRow, settledRow, snoozedRow, type LifecycleRow } from "@/shared/lifecycle";
import { DAY, HOUR, makeProject, makeThread, PROJECTS, working } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { SWEEP_MS } from "../commands/sweep";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const fresh = { createdAt: NOW - 5 * MIN, updatedAt: NOW - 5 * MIN, latestAttentionAt: NOW - 5 * MIN };
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
const slot = (id: string) => card(id).querySelector("[data-status-slot] [data-status]")?.textContent ?? null;
/** Clicks and lets the command it runs finish, so nothing outlives the test. */
async function press(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

describe("AC17: the Full card", () => {
  it("draws the project and status on line 1, the title on line 2, and branch, machine, counts and the harness on line 3", async () => {
    const thread = makeThread({
      id: "a",
      title: "Fix the thing",
      ...fresh,
      activity: { workflows: 2, backgroundAgents: 1 },
      environment: { branchName: "feat/x", isWorktree: true },
    });
    await mount({ threads: [thread] });
    const el = card("a");
    expect(el.getAttribute("data-card")).toBe("full");
    expect(el.querySelector("[data-project-name]")?.textContent).toBe("Alpha");
    expect(el.querySelector("[data-title]")?.textContent).toBe("Fix the thing");
    expect(el.querySelector("[data-location=branch]")?.textContent).toBe("feat/x");
    expect(el.querySelector('[aria-label="Machine: Laptop"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="2 workflows"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="1 background agents"]')).not.toBeNull();
    expect(el.querySelector("[data-harness=claude-code]")).not.toBeNull();
    expect(slot("a")).toBe("5m");
  });

  it("names the machine where there is no branch, and draws no machine icon beside it", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh, environment: { branchName: null } })] });
    expect(card("a").querySelector("[data-location=machine]")?.textContent).toBe("Laptop");
    expect(card("a").querySelector('[aria-label="Machine: Laptop"]')).toBeNull();
  });

  it("makes unread and woke titles bold and a read idle title muted", async () => {
    const m = await mount({
      threads: [makeThread({ id: "unread", ...fresh, isUnread: true, indicator: "unread-success" }), makeThread({ id: "idle", ...fresh }), makeThread({ id: "woke", ...fresh })],
      server: { rows: { woke: snoozedRow(NOW - MIN, NOW - HOUR) } },
    });
    expect(card("unread").querySelector("[data-title]")!.className).toContain("font-semibold");
    expect(card("idle").querySelector("[data-title]")!.className).toContain("text-muted-foreground");
    expect(card("woke").querySelector("[data-title]")!.className).toContain("font-semibold");
    expect(m.host.state().threads).toHaveLength(3);
  });
});

describe("AC17: the Status slot", () => {
  it("shows one thing, by precedence", async () => {
    await mount({
      threads: [
        makeThread({ id: "ask", ...fresh, hasPendingInteraction: true, indicator: "unread-error" }),
        makeThread({ id: "queued", ...fresh, queuedWork: "waiting" }),
        makeThread({ id: "failedq", ...fresh, queuedWork: "failed", indicator: "runtime" }),
        makeThread({ id: "failed", ...fresh, indicator: "unread-error", indicatorLabel: "Thread failed" }),
        makeThread({ id: "unread", ...fresh, indicator: "unread-success" }),
        makeThread({ id: "idle", ...fresh }),
      ],
    });
    expect(["ask", "queued", "failedq", "failed", "unread", "idle"].map(slot)).toEqual(["Needs you", "Queued", "Send failed", "Failed", "Unread", "5m"]);
  });

  it("reads Drafting · 2m while a thread with an unsent draft works, counting from the stamp that survives a reload, and Draft once it is idle", async () => {
    localStorage.setItem("thread-glance:workingSince", JSON.stringify({ a: { since: Date.now() - 2 * MIN - 1_000, seenAt: Date.now() - 5_000 } }));
    const m = await mount({
      threads: [makeThread({ id: "a", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "b", ...fresh })],
    });
    act(() => m.host.update({ draftIds: new Set(["a", "b"]) }));
    await flush();
    expect(slot("a")).toBe("Drafting · 2m");
    expect(slot("b")).toBe("Draft");
    act(() => m.host.updateThread("a", { status: "idle", runtimeStatus: "idle", indicator: "none" }));
    await flush();
    expect(slot("a")).toBe("Draft");
  });

  it("starts the count afresh once a thread has been seen idle", async () => {
    localStorage.setItem("thread-glance:workingSince", JSON.stringify({ a: { since: Date.now() - 30 * MIN, seenAt: Date.now() } }));
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh, ...working, indicator: "runtime" })] });
    expect(slot("a")).toBe("Working · 30m");
    act(() => m.host.updateThread("a", { status: "idle", runtimeStatus: "idle", indicator: "none" }));
    await flush();
    act(() => m.host.updateThread("a", { ...working, indicator: "runtime" }));
    await flush();
    expect(slot("a")).toBe("Working");
  });

  it("draws the Failed label in the light theme's red variable, never a dark: utility", async () => {
    await mount({ threads: [makeThread({ id: "f", ...fresh, indicator: "unread-error" })] });
    const label = card("f").querySelector("[data-status=failed]")!;
    expect(label.className).toContain("text-[color:var(--tg-failed)]");
    expect(label.className).not.toContain("dark:");
  });

  it("refreshes ages with the list clock", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", createdAt: NOW - 59 * MIN, updatedAt: NOW - 59 * MIN, latestAttentionAt: NOW - 59 * MIN })] });
    expect(slot("a")).toBe("59m");
    const store = (await import("../store/list-store")).attachedListStores()[0]!;
    act(() => store.feed({ now: NOW + 2 * MIN }));
    await flush();
    expect(slot("a")).toBe("1h");
    expect(m.host.state().threads).toHaveLength(1);
  });
});

describe("AC17: the Folded card", () => {
  it("folds a working thread to one line with Compact working threads on, and unfolds when the turn ends", async () => {
    const m = await mount({
      threads: [makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "i", ...fresh })],
      server: { settings: { threadDisplay: "compact-working" } },
    });
    expect(card("w").getAttribute("data-card")).toBe("folded");
    expect(card("i").getAttribute("data-card")).toBe("full");
    expect(card("w").style.height).toBe("32px");
    expect(card("w").querySelector("[data-title]")).not.toBeNull();
    act(() => m.host.updateThread("w", { status: "idle", runtimeStatus: "idle", indicator: "unread-success" }));
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("full");
    expect(card("w").style.height).toBe("72px");
  });

  it("unfolds when the thread needs you or fails", async () => {
    const m = await mount({
      threads: [makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" })],
      server: { settings: { threadDisplay: "compact-working" } },
    });
    act(() => m.host.updateThread("w", { hasPendingInteraction: true, indicator: "waiting-for-input" }));
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("full");
  });

  it("folds every Pinned, Active and Inactive thread under Compact all threads, and a turn ending leaves it folded", async () => {
    const old = { createdAt: NOW - DAY, updatedAt: NOW - DAY, latestAttentionAt: NOW - DAY };
    const m = await mount({
      threads: [
        makeThread({ id: "pin", ...fresh, isPinned: true, pinnedAt: NOW }),
        makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" }),
        makeThread({ id: "i", ...old }),
      ],
      server: { settings: { threadDisplay: "compact-all" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inactive (1)" }));
    await flush();
    for (const id of ["pin", "w", "i"]) expect(card(id).getAttribute("data-card")).toBe("folded");
    expect(card("i").getAttribute("data-shelf-of")).toBe("inactive");
    expect(card("pin").style.height).toBe("32px");
    act(() => m.host.updateThread("w", { status: "idle", runtimeStatus: "idle", indicator: "unread-success" }));
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("folded");
  });

  it("unfolds a thread that fails or needs you under Compact all threads until that clears", async () => {
    const m = await mount({
      threads: [makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "q", ...fresh })],
      server: { settings: { threadDisplay: "compact-all" } },
    });
    act(() => {
      m.host.updateThread("w", { status: "idle", runtimeStatus: "idle", indicator: "unread-error" });
      m.host.updateThread("q", { hasPendingInteraction: true, indicator: "waiting-for-input" });
    });
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("full");
    expect(card("q").getAttribute("data-card")).toBe("full");
    act(() => {
      m.host.updateThread("w", { indicator: "none" });
      m.host.updateThread("q", { hasPendingInteraction: false, indicator: "none" });
    });
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("folded");
    expect(card("q").getAttribute("data-card")).toBe("folded");
  });

  it("keeps pinned and woke threads full under Compact all threads with the keep options on", async () => {
    const old = { createdAt: NOW - 10 * HOUR, updatedAt: NOW - 10 * HOUR, latestAttentionAt: NOW - 10 * HOUR };
    await mount({
      threads: [makeThread({ id: "pin", ...fresh, isPinned: true, pinnedAt: NOW }), makeThread({ id: "woke", ...old }), makeThread({ id: "a", ...fresh })],
      server: {
        rows: { woke: snoozedRow(NOW - MIN, NOW - 8 * HOUR) },
        settings: { threadDisplay: "compact-all", keepPinnedAsFullCards: true, keepWokeAsFullCards: true },
      },
    });
    expect(card("pin").getAttribute("data-card")).toBe("full");
    expect(card("woke").getAttribute("data-card")).toBe("full");
    expect(card("woke").querySelector("[data-woke]")).not.toBeNull();
    expect(card("a").getAttribute("data-card")).toBe("folded");
  });

  it("draws every Working-shelf row folded", async () => {
    await mount({ threads: [makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" })], server: { settings: { workingShelf: true } } });
    expect(card("w").getAttribute("data-card")).toBe("folded");
    expect(card("w").getAttribute("data-shelf-of")).toBe("working");
  });
});

describe("AC17: the Slim row", () => {
  const rows: Record<string, LifecycleRow> = {
    parked: parkedRow(NOW - 2 * DAY),
    snoozed: snoozedRow(NOW + 3 * HOUR, NOW - HOUR),
    settled: settledRow(NOW - DAY, "manual"),
  };
  const old = { createdAt: NOW - 5 * DAY, updatedAt: NOW - 4 * DAY, latestAttentionAt: NOW - 4 * DAY };
  /** Mounts with the three slim shelves open. */
  async function mountSlim() {
    const m = await mount({ threads: threads(), server: { rows, settings: { inactiveShelf: false } } });
    for (const label of ["Parked (1)", "Snoozed (1)", "Settled (1)"]) fireEvent.click(screen.getByRole("button", { name: label }));
    await flush();
    return m;
  }
  const threads = () => [makeThread({ id: "parked", ...old }), makeThread({ id: "snoozed", ...old }), makeThread({ id: "settled", ...old, indicator: "unread-success" })];

  it("is 32 px, with the shelf's label and its restore button", async () => {
    await mountSlim();
    for (const id of ["parked", "snoozed", "settled"]) {
      expect(card(id).getAttribute("data-card")).toBe("slim");
      expect(card(id).style.height).toBe("32px");
    }
    expect(card("parked").textContent).toContain("Waiting 2d");
    expect(within(card("parked")).getByRole("button", { name: "Resume thread" })).toBeTruthy();
    expect(card("snoozed").textContent).toContain("3h");
    expect(within(card("snoozed")).getByRole("button", { name: "Wake thread now" })).toBeTruthy();
    expect(card("settled").textContent).toContain("Unread");
    expect(within(card("settled")).getByRole("button", { name: "Un-settle thread" })).toBeTruthy();
  });

  it("restores with its button", async () => {
    const m = await mountSlim();
    await press(within(card("parked")).getByRole("button", { name: "Resume thread" }));
    expect(m.server.calls.some((call) => call.method === "resume")).toBe(true);
  });

  it("leaves its other actions to bb's thread menu, which opens on the row's … and on right-click", async () => {
    await mountSlim();
    fireEvent.click(within(card("parked")).getByRole("button", { name: /Thread actions for/ }));
    expect(screen.getByRole("menu", { name: "Thread actions" })).toBeTruthy();
  });
});

describe("rows: Woke, Unpin and the thread menu", () => {
  it("shows Woke with a Dismiss Woke marker button that clears it", async () => {
    const m = await mount({ threads: [makeThread({ id: "w", ...fresh })], server: { rows: { w: snoozedRow(NOW - MIN, NOW - HOUR) } } });
    expect(card("w").querySelector("[data-woke]")?.textContent).toBe("Woke");
    await press(within(card("w")).getByRole("button", { name: "Dismiss Woke marker" }));
    expect(m.server.calls.some((call) => call.method === "dismissWoke")).toBe(true);
  });

  it("offers Unpin on a pinned thread", async () => {
    const m = await mount({ threads: [makeThread({ id: "p", ...fresh, isPinned: true, pinnedAt: NOW })] });
    await press(within(card("p")).getAllByRole("button", { name: "Unpin Thread p" })[0]!);
    expect(m.host.sdkCalls.some((call) => call.method === "threads.unpin")).toBe(true);
  });

  it("offers Snooze and Settle on hover only while the thread is not busy and not woke", async () => {
    await mount({
      threads: [makeThread({ id: "idle", ...fresh }), makeThread({ id: "busy", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "woke", ...fresh })],
      server: { rows: { woke: snoozedRow(NOW - MIN, NOW - HOUR) } },
    });
    expect(within(card("idle")).queryByRole("button", { name: "Snooze Thread idle" })).not.toBeNull();
    expect(within(card("idle")).queryByRole("button", { name: "Settle Thread idle" })).not.toBeNull();
    expect(within(card("busy")).queryByRole("button", { name: /^Snooze/ })).toBeNull();
    expect(within(card("busy")).queryByRole("button", { name: /^Settle/ })).toBeNull();
    expect(within(card("woke")).queryByRole("button", { name: /^Snooze/ })).toBeNull();
  });

  it("settles from the card's check, playing the sweep on the card first", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await press(within(card("a")).getByRole("button", { name: "Settle Thread a" }));
      expect(card("a").querySelector("[data-sweep]")).not.toBeNull();
      expect(m.server.calls.filter((call) => call.method === "settle")).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SWEEP_MS);
      });
      expect(card("a").querySelector("[data-sweep]")).toBeNull();
      expect(m.server.calls.filter((call) => call.method === "settle")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AC24: project colours", () => {
  const two = () => [
    makeThread({ id: "a1", title: "A1", projectId: "proj_a", ...fresh }),
    makeThread({ id: "a2", title: "A2", projectId: "proj_a", createdAt: NOW - 6 * MIN, updatedAt: NOW - 6 * MIN, latestAttentionAt: NOW - 6 * MIN }),
    makeThread({ id: "b1", title: "B1", projectId: "proj_b", createdAt: NOW - 7 * MIN, updatedAt: NOW - 7 * MIN, latestAttentionAt: NOW - 7 * MIN }),
  ];

  it("draws no colour while Project colors is off", async () => {
    await mount({ threads: two() });
    expect(document.querySelector("[data-project-stripe]")).toBeNull();
    expect(card("a1").querySelector<HTMLElement>("[data-project-name]")!.style.color).toBe("");
  });

  it("colours the names, draws a stripe on full cards, and tints the monogram at 20 %", async () => {
    await mount({ threads: two(), server: { settings: { projectColours: true }, appearance: { colours: { proj_b: "#336699" }, icons: {} } } });
    expect(card("a1").querySelector("[data-project-stripe]")).not.toBeNull();
    expect(card("a1").querySelector<HTMLElement>("[data-project-name]")!.style.color).not.toBe("");
    const stripe = card("b1").querySelector<HTMLElement>("[data-project-stripe]")!;
    expect(stripe.style.backgroundColor).toBe("rgb(51, 102, 153)");
    expect(card("b1").querySelector<HTMLElement>("[data-monogram]")!.style.backgroundColor).toBe("rgba(51, 102, 153, 0.2)");
  });

  it("shows stripes only on project headers with Grouped projects only, and the names stay coloured", async () => {
    await mount({ threads: two(), server: { settings: { projectColours: true, stripesIn: "grouped" }, order: ["a1", "a2", "b1"] } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort Active" }), { target: { value: "project" } });
    await flush();
    const header = document.querySelector<HTMLElement>("[data-group-key]")!;
    expect(header.querySelector("[data-project-stripe]")).not.toBeNull();
    expect(document.querySelectorAll("[data-card] [data-project-stripe]")).toHaveLength(0);
    expect(header.querySelector<HTMLElement>("[data-project-name]")!.style.color).not.toBe("");
    expect(card("b1").querySelector<HTMLElement>("[data-project-name]")!.style.color).not.toBe("");
  });

  it("hides the project line of cards inside a group and keeps its stripe off the lone rows", async () => {
    await mount({ threads: two(), server: { settings: { projectColours: true }, order: ["a1", "a2", "b1"] } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort Active" }), { target: { value: "project" } });
    await flush();
    expect(card("a1").querySelector("[data-project-name]")).toBeNull();
    expect(card("a1").style.height).toBe("52px");
    expect(card("b1").querySelector("[data-project-name]")).not.toBeNull();
  });

  it("draws no stripe on a folded card with Show stripes in Full mode only", async () => {
    const threads = [makeThread({ id: "w", projectId: "proj_a", ...fresh, ...working, indicator: "runtime" })];
    await mount({ threads, server: { settings: { projectColours: true, workingShelf: true, stripesIn: "full" } }, projects: [...PROJECTS, makeProject("x")] });
    expect(card("w").querySelector("[data-project-stripe]")).toBeNull();
  });
});

describe("project icons", () => {
  it("draws the monogram while the icon has not loaded", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    expect(card("a").querySelector("[data-monogram]")?.textContent).toBe("A");
  });
});
