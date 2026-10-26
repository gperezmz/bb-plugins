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

describe("a status another plugin set on a row", () => {
  const sandbox = { icon: "Box", label: "Sandbox ready", tone: "success" } as const;
  const icon = (id: string) => card(id).querySelector("[data-status-slot] [data-status] [data-icon]")?.getAttribute("data-icon") ?? null;

  it("shows on a Full card as bb's icon in its colour with the age beside it, and follows the host's updates", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    act(() => m.host.update({ rowStatuses: new Map([["a", sandbox]]) }));
    await flush();
    expect(card("a").getAttribute("data-card")).toBe("full");
    expect(slot("a")).toBe("5m");
    expect(icon("a")).toBe("Box");
    const status = card("a").querySelector("[data-status=plugin]")!;
    expect(status.getAttribute("aria-label")).toBe("Sandbox ready, 5m");
    expect(within(card("a")).getByRole("img", { name: "Sandbox ready, 5m" })).toBe(status);
    expect(status.className).toContain("text-success-foreground");
    act(() => m.host.update({ rowStatuses: new Map() }));
    await flush();
    expect(icon("a")).toBeNull();
  });

  it("draws each tone in the class bb's own list uses", async () => {
    const m = await mount({
      threads: [makeThread({ id: "d", ...fresh }), makeThread({ id: "e", ...fresh }), makeThread({ id: "r", ...fresh })],
    });
    act(() =>
      m.host.update({
        rowStatuses: new Map([
          ["d", { icon: "Box", label: "plain" }],
          ["e", { icon: "Box", label: "broken", tone: "error" }],
          ["r", { icon: "Box", label: "busy", tone: "running" }],
        ]),
      }),
    );
    await flush();
    const colour = (id: string) => card(id).querySelector("[data-status=plugin]")!.className;
    expect(colour("d")).toContain("text-muted-foreground");
    expect(colour("e")).toContain("text-destructive");
    expect(colour("r")).toContain("text-success");
    expect(colour("r")).not.toContain("text-success-foreground");
  });

  it("shows on a Folded card as the icon and the age, named for assistive technology", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh })], server: { settings: { threadDisplay: "compact-all" } } });
    act(() => m.host.update({ rowStatuses: new Map([["a", sandbox]]) }));
    await flush();
    expect(card("a").getAttribute("data-card")).toBe("folded");
    expect(icon("a")).toBe("Box");
    expect(card("a").querySelector("[data-status-slot] [data-status=plugin]")?.textContent).toBe("5mSandbox ready, 5m");
    expect(card("a").querySelector("[data-status-slot] [data-status=plugin] [aria-hidden]:not([data-icon])")?.textContent).toBe("5m");
  });

  it("gives way to Needs you, Send failed, Queued, working and failed", async () => {
    const m = await mount({
      threads: [
        makeThread({ id: "ask", ...fresh, hasPendingInteraction: true, indicator: "waiting-for-input" }),
        makeThread({ id: "failedq", ...fresh, queuedWork: "failed" }),
        makeThread({ id: "queued", ...fresh, queuedWork: "waiting" }),
        makeThread({ id: "working", ...fresh, ...working, indicator: "runtime" }),
        makeThread({ id: "failed", ...fresh, indicator: "unread-error" }),
      ],
    });
    const ids = ["ask", "failedq", "queued", "working", "failed"];
    act(() => m.host.update({ rowStatuses: new Map(ids.map((id) => [id, sandbox])) }));
    await flush();
    expect(ids.map(slot)).toEqual(["Needs you", "Send failed", "Queued", "Working", "Failed"]);
    expect(ids.map(icon)).not.toContain("Box");
  });

  it("leaves a Slim row with its shelf's label and status", async () => {
    const old = { createdAt: NOW - 5 * DAY, updatedAt: NOW - 4 * DAY, latestAttentionAt: NOW - 4 * DAY };
    const m = await mount({
      threads: [makeThread({ id: "parked", ...old }), makeThread({ id: "settled", ...old, indicator: "unread-success" })],
      server: { rows: { parked: parkedRow(NOW - 2 * DAY), settled: settledRow(NOW - DAY, "manual") }, settings: { inactiveShelf: false } },
    });
    for (const label of ["Parked (1)", "Settled (1)"]) fireEvent.click(screen.getByRole("button", { name: label }));
    act(() => m.host.update({ rowStatuses: new Map(["parked", "settled"].map((id) => [id, sandbox])) }));
    await flush();
    for (const id of ["parked", "settled"]) expect(card(id).getAttribute("data-card")).toBe("slim");
    expect(card("parked").textContent).toContain("Waiting 2d");
    expect(card("settled").textContent).toContain("Unread");
    expect(document.querySelector("[data-status=plugin]")).toBeNull();
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

  it("unfolds a thread that fails or needs you under Compact all threads until you open it or that clears", async () => {
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
    act(() => m.host.updateProps({ activeThreadId: "q" }));
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("folded");
    act(() => {
      m.host.updateThread("w", { indicator: "none" });
      m.host.updateThread("q", { hasPendingInteraction: false, indicator: "none" });
    });
    await flush();
    expect(card("w").getAttribute("data-card")).toBe("folded");
    expect(card("q").getAttribute("data-card")).toBe("folded");
  });

  it("unfolds a thread you had read once it asks, folds it while you have opened it, and unfolds it for its next question", async () => {
    const m = await mount({
      threads: [makeThread({ id: "q", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "other", ...fresh })],
      server: { settings: { threadDisplay: "compact-all" } },
      activeThreadId: "q",
    });
    act(() => m.host.updateProps({ activeThreadId: "other" }));
    await flush();
    const ask = () => act(() => m.host.updateThread("q", { status: "idle", runtimeStatus: "idle", hasPendingInteraction: true, isUnread: false, indicator: "waiting-for-input" }));
    ask();
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("full");
    act(() => m.host.updateProps({ activeThreadId: "q" }));
    await flush();
    act(() => m.host.updateProps({ activeThreadId: "other" }));
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("folded");
    act(() => m.host.updateThread("q", { hasPendingInteraction: false, indicator: "none" }));
    await flush();
    ask();
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("full");
  });

  it("keeps a question you opened folded through a list bb reloads", async () => {
    const m = await mount({
      threads: [makeThread({ id: "q", ...fresh, hasPendingInteraction: true, indicator: "waiting-for-input" }), makeThread({ id: "other", ...fresh })],
      server: { settings: { threadDisplay: "compact-all" } },
      activeThreadId: "q",
    });
    act(() => m.host.updateProps({ activeThreadId: "other" }));
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("folded");
    const { threads } = m.host.state();
    for (const status of ["loading", "error"] as const) {
      act(() => m.host.update({ status, threads: [] }));
      await flush();
      act(() => m.host.update({ status: "ready", threads }));
      await flush();
      expect(card("q").getAttribute("data-card")).toBe("folded");
    }
  });

  it("unfolds a question that replaced the one you opened while no frame ran, as in a hidden window", async () => {
    const m = await mount({
      threads: [makeThread({ id: "q", ...fresh, hasPendingInteraction: true, indicator: "waiting-for-input" }), makeThread({ id: "other", ...fresh })],
      server: { settings: { threadDisplay: "compact-all" } },
      activeThreadId: "q",
    });
    act(() => m.host.updateProps({ activeThreadId: "other" }));
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("folded");
    // Both lists reach the store before any frame applies them.
    act(() => m.host.updateThread("q", { hasPendingInteraction: false, indicator: "none" }));
    act(() => m.host.updateThread("q", { hasPendingInteraction: true, indicator: "waiting-for-input" }));
    await flush();
    expect(card("q").getAttribute("data-card")).toBe("full");
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

  it("folds a woke thread kept full under Compact all threads once opening it clears its Woke marker", async () => {
    const old = { createdAt: NOW - 10 * HOUR, updatedAt: NOW - 10 * HOUR, latestAttentionAt: NOW - 10 * HOUR };
    const m = await mount({
      threads: [makeThread({ id: "woke", ...old })],
      server: { rows: { woke: snoozedRow(NOW - MIN, NOW - 8 * HOUR) }, settings: { threadDisplay: "compact-all", keepWokeAsFullCards: true } },
      activeThreadId: "woke",
    });
    await flush();
    expect(m.server.calls.some((call) => call.method === "dismissWoke")).toBe(true);
    expect(card("woke").querySelector("[data-woke]")).toBeNull();
    expect(card("woke").getAttribute("data-card")).toBe("folded");
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

  it("offers Snooze and Settle on hover only while the thread is not busy and not woke, and Settle alone on a busy one", async () => {
    await mount({
      threads: [makeThread({ id: "idle", ...fresh }), makeThread({ id: "busy", ...fresh, ...working, indicator: "runtime" }), makeThread({ id: "woke", ...fresh })],
      server: { rows: { woke: snoozedRow(NOW - MIN, NOW - HOUR) } },
    });
    expect(within(card("idle")).queryByRole("button", { name: "Snooze Thread idle" })).not.toBeNull();
    expect(within(card("idle")).queryByRole("button", { name: "Settle Thread idle" })).not.toBeNull();
    expect(within(card("busy")).queryByRole("button", { name: /^Snooze/ })).toBeNull();
    expect(within(card("busy")).queryByRole("button", { name: /^Settle/ })).not.toBeNull();
    expect(within(card("woke")).queryByRole("button", { name: /^Snooze/ })).toBeNull();
  });

  it("offers no hover actions on a card whose thread has a question of its own", async () => {
    await mount({ threads: [makeThread({ id: "asking", ...fresh, hasPendingInteraction: true })] });
    expect(within(card("asking")).queryByRole("button", { name: /^Settle/ })).toBeNull();
    expect(within(card("asking")).queryByRole("button", { name: /^Snooze/ })).toBeNull();
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

describe("Project icon only", () => {
  const rows = [
    makeThread({ id: "w", ...fresh, ...working, indicator: "runtime" }),
    makeThread({ id: "i", ...fresh }),
  ];

  it("draws every folded card with the project's icon and no name, working ones included", async () => {
    await mount({ threads: rows, server: { settings: { threadDisplay: "compact-all", workingShelf: true, projectIconOnly: true } } });
    for (const id of ["w", "i"]) {
      expect(card(id).getAttribute("data-card")).toBe("folded");
      expect(card(id).querySelector("[data-project-name]")).toBeNull();
      expect(card(id).querySelector("[data-monogram]")?.textContent).toBe("A");
      expect(card(id).querySelector("[data-title]")).not.toBeNull();
    }
  });

  it("leaves folded cards as they are with the setting off", async () => {
    await mount({ threads: rows, server: { settings: { threadDisplay: "compact-working" } } });
    expect(card("w").querySelector("[data-project-name]")?.textContent).toBe("Alpha");
  });

  it("keeps the name on a full card", async () => {
    await mount({ threads: rows, server: { settings: { threadDisplay: "compact-working", projectIconOnly: true } } });
    expect(card("w").querySelector("[data-project-name]")).toBeNull();
    expect(card("i").getAttribute("data-card")).toBe("full");
    expect(card("i").querySelector("[data-project-name]")?.textContent).toBe("Alpha");
  });

  it("still names the project in the hover card", async () => {
    await mount({ threads: [rows[0]!], server: { settings: { threadDisplay: "compact-working", projectIconOnly: true } } });
    fireEvent.keyDown(document.body, { key: "Tab" });
    await act(async () => document.querySelector<HTMLElement>('a[data-sidebar-thread-id="w"]')!.focus());
    await flush();
    expect(document.querySelector("[data-hover-card]")?.textContent).toContain("Alpha");
  });

  it("names the project once the pointer rests on the icon, and not when it rests elsewhere on the card", async () => {
    await mount({ threads: [rows[0]!], server: { settings: { threadDisplay: "compact-working", projectIconOnly: true } } });
    vi.useFakeTimers();
    try {
      const icon = card("w").querySelector<HTMLElement>("[data-monogram]")!.parentElement!;
      vi.spyOn(icon, "getBoundingClientRect").mockReturnValue({ left: 10, right: 22, top: 10, bottom: 22, width: 12, height: 12, x: 10, y: 10, toJSON: () => ({}) });
      fireEvent.pointerMove(card("w"), { clientX: 100, clientY: 15 });
      await act(async () => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole("tooltip")).toBeNull();
      fireEvent.pointerMove(card("w"), { clientX: 15, clientY: 15 });
      await act(async () => vi.advanceTimersByTime(1000));
      expect(screen.getByRole("tooltip").textContent).toBe("Alpha");
      fireEvent.pointerMove(card("w"), { clientX: 100, clientY: 15 });
      await act(async () => vi.advanceTimersByTime(10));
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("dismissing the tooltip", () => {
    const onIcon = { clientX: 15, clientY: 15 };
    const off = { clientX: 100, clientY: 15 };

    // Mounts with the tooltip open on the icon, then runs `body` under fake timers.
    async function withTooltipOpen(settings: Record<string, unknown>, body: () => Promise<void>) {
      await mount({ threads: [rows[0]!], server: { settings: { threadDisplay: "compact-working", projectIconOnly: true, ...settings } } });
      vi.useFakeTimers();
      try {
        const icon = card("w").querySelector<HTMLElement>("[data-monogram]")!.parentElement!;
        vi.spyOn(icon, "getBoundingClientRect").mockReturnValue({ left: 10, right: 22, top: 10, bottom: 22, width: 12, height: 12, x: 10, y: 10, toJSON: () => ({}) });
        fireEvent.pointerMove(card("w"), onIcon);
        await act(async () => vi.advanceTimersByTime(1000));
        expect(screen.getByRole("tooltip").textContent).toBe("Alpha");
        await body();
      } finally {
        vi.useRealTimers();
      }
    }

    async function stayClosedWhileResting() {
      fireEvent.pointerMove(card("w"), onIcon);
      await act(async () => vi.advanceTimersByTime(5000));
      expect(screen.queryByRole("tooltip")).toBeNull();
    }

    async function reopenAfterLeavingAndResting() {
      fireEvent.pointerMove(card("w"), off);
      fireEvent.pointerMove(card("w"), onIcon);
      await act(async () => vi.advanceTimersByTime(399));
      expect(screen.queryByRole("tooltip")).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.getByRole("tooltip").textContent).toBe("Alpha");
    }

    it("closes on a click without stopping it, and stays closed until the pointer has left the icon and rested again", async () => {
      await withTooltipOpen({}, async () => {
        // fireEvent returns false when a listener cancelled the event.
        expect(fireEvent.pointerDown(card("w"), onIcon)).toBe(true);
        await act(async () => vi.advanceTimersByTime(0));
        expect(screen.queryByRole("tooltip")).toBeNull();
        await stayClosedWhileResting();
        await reopenAfterLeavingAndResting();
      });
    });

    it("closes on a right-click and on a context menu opened from the keyboard without stopping them", async () => {
      const seen = vi.fn();
      document.addEventListener("contextmenu", seen);
      await withTooltipOpen({}, async () => {
        expect(fireEvent.pointerDown(card("w"), { ...onIcon, button: 2 })).toBe(true);
        fireEvent.contextMenu(card("w"), onIcon);
        expect(seen).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTime(0));
        expect(screen.queryByRole("tooltip")).toBeNull();
        await stayClosedWhileResting();
        await reopenAfterLeavingAndResting();
        fireEvent.contextMenu(card("w").querySelector("a")!);
        expect(seen).toHaveBeenCalledTimes(2);
        await act(async () => vi.advanceTimersByTime(0));
        expect(screen.queryByRole("tooltip")).toBeNull();
      }).finally(() => document.removeEventListener("contextmenu", seen));
    });

    it("closes on Escape, which still reaches the document's other handlers", async () => {
      const seen = vi.fn();
      document.addEventListener("keydown", seen);
      try {
        await withTooltipOpen({}, async () => {
          fireEvent.keyDown(document.body, { key: "Escape" });
          await act(async () => vi.advanceTimersByTime(0));
          expect(seen).toHaveBeenCalledTimes(1);
          expect(screen.queryByRole("tooltip")).toBeNull();
          await stayClosedWhileResting();
          await reopenAfterLeavingAndResting();
        });
      } finally {
        document.removeEventListener("keydown", seen);
      }
    });

    it("closes on Escape that a handler below the document stops", async () => {
      await withTooltipOpen({}, async () => {
        const stop = (event: Event) => event.stopPropagation();
        document.body.addEventListener("keydown", stop);
        try {
          fireEvent.keyDown(document.body, { key: "Escape" });
        } finally {
          document.body.removeEventListener("keydown", stop);
        }
        await act(async () => vi.advanceTimersByTime(0));
        expect(screen.queryByRole("tooltip")).toBeNull();
      });
    });

    it("closes a tooltip that has not opened yet, and leaves it closed", async () => {
      await mount({ threads: [rows[0]!], server: { settings: { threadDisplay: "compact-working", projectIconOnly: true } } });
      vi.useFakeTimers();
      try {
        const icon = card("w").querySelector<HTMLElement>("[data-monogram]")!.parentElement!;
        vi.spyOn(icon, "getBoundingClientRect").mockReturnValue({ left: 10, right: 22, top: 10, bottom: 22, width: 12, height: 12, x: 10, y: 10, toJSON: () => ({}) });
        fireEvent.pointerMove(card("w"), onIcon);
        await act(async () => vi.advanceTimersByTime(200));
        fireEvent.keyDown(document.body, { key: "Escape" });
        await stayClosedWhileResting();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores a click while the pointer is not on the icon", async () => {
      await withTooltipOpen({}, async () => {
        fireEvent.pointerMove(card("w"), off);
        await act(async () => vi.advanceTimersByTime(0));
        fireEvent.pointerDown(card("w"), off);
        await reopenAfterLeavingAndResting();
      });
    });
  });
});
