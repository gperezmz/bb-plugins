// @vitest-environment jsdom
// AC19: the Hover card and the Jump hints; and AC5's clock menu on a card.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSnoozePickerRequests } from "../commands/snooze-picker-request";
import { parkedRow, settledRow } from "@/shared/lifecycle";
import { makeThread } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { forgetModelLookups } from "../sync/model-lookup";
import { closeHoverCards } from "./rows/hover-state";

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const fresh = { createdAt: NOW - 5 * MIN, updatedAt: NOW - 5 * MIN, latestAttentionAt: NOW - 5 * MIN };
const anchor = (id: string) => document.querySelector<HTMLElement>(`a[data-sidebar-thread-id="${id}"]`)!;
const cards = () => document.querySelectorAll("[data-hover-card]");

afterEach(() => {
  vi.useRealTimers();
  closeHoverCards();
  forgetModelLookups();
});

/** A pull request as GitHub PR Status reports it; `patch` replaces top-level fields. */
const pullRequest = (patch: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Add shelves",
  state: "open",
  url: "https://example.test/pr/7",
  baseRefName: "main",
  headRefName: "feat/shelves",
  updatedAt: "2026-10-24T12:00:00Z",
  autoMerge: false,
  inMergeQueue: null,
  checks: { state: "failing", totalCount: 2, passedCount: 1, failedCount: 1, pendingCount: 0 },
  review: { state: "review_requested", reviewRequestCount: 1 },
  mergeability: { state: "mergeable", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" },
  attention: "checks_failed",
  ...patch,
});
const available = (patch: Record<string, unknown> = {}) => ({ outcome: "available", pullRequest: pullRequest(patch) });

const models = (options: unknown) => ({
  threads: { defaultExecutionOptions: async () => options },
  providers: { models: async () => ({ models: [{ id: "claude-x", model: "claude-x", displayName: "Claude X" }] }) },
});

/** Keyboard focus, which opens the card at once. */
async function focusWithKeyboard(element: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => element.focus());
  await flush();
}

describe("AC19: the Hover card", () => {
  it("opens on keyboard focus at once, to the right, 256 px wide, with the title, project, machine and branch", async () => {
    await mount({
      threads: [makeThread({ id: "a", title: "Fix the thing", ...fresh, environment: { branchName: "feat/x" } })],
      slot: { sdk: models({ model: "claude-x", reasoningLevel: "high" }) },
    });
    expect(cards()).toHaveLength(0);
    await focusWithKeyboard(anchor("a"));
    const hover = document.querySelector<HTMLElement>("[data-hover-card]")!;
    expect(hover.getAttribute("data-side")).toBe("right");
    expect(hover.className).toContain("w-64");
    const text = hover.textContent!;
    for (const part of ["Fix the thing", "Alpha", "Laptop", "feat/x"]) expect(text).toContain(part);
  });

  it("does not open when a click focuses the link", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    fireEvent.pointerDown(document.body);
    await act(async () => anchor("a").focus());
    await flush();
    expect(cards()).toHaveLength(0);
  });

  it("shows the harness with its status glyph, then the model and reasoning level loaded from bb", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => (release = resolve));
    await mount({
      threads: [makeThread({ id: "a", ...fresh, indicator: "unread-error" })],
      slot: {
        sdk: {
          threads: { defaultExecutionOptions: () => pending },
          providers: { models: async () => ({ models: [{ id: "claude-x", model: "claude-x", displayName: "Claude X" }] }) },
        },
      },
    });
    await focusWithKeyboard(anchor("a"));
    const hover = document.querySelector<HTMLElement>("[data-hover-card]")!;
    expect(within(hover).getAllByText("Loading…")).toHaveLength(1);
    expect(hover.querySelector("[data-harness=claude-code]")).not.toBeNull();
    expect(hover.querySelector("[title=Failed]")).not.toBeNull();
    await act(async () => release({ model: "claude-x", reasoningLevel: "high" }));
    await flush();
    expect(within(hover).getByText("Claude X High")).toBeTruthy();
    expect(hover.textContent).not.toContain("Reasoning");
  });

  it("shows the catalog's label for a provider-specific level", async () => {
    await mount({
      threads: [makeThread({ id: "a", ...fresh })],
      slot: {
        sdk: {
          threads: { defaultExecutionOptions: async () => ({ model: "claude-x", reasoningLevel: "ultra" }) },
          providers: {
            models: async () => ({
              models: [{ id: "claude-x", model: "claude-x", displayName: "Claude X", supportedReasoningEfforts: [{ reasoningEffort: "ultra", label: "Ultracode" }] }],
            }),
          },
        },
      },
    });
    await focusWithKeyboard(anchor("a"));
    await flush();
    expect(within(document.querySelector<HTMLElement>("[data-hover-card]")!).getByText("Claude X Ultracode")).toBeTruthy();
  });

  it("says Not set when bb has no model and Unavailable when it cannot be loaded", async () => {
    await mount({
      threads: [makeThread({ id: "a", ...fresh }), makeThread({ id: "b", ...fresh })],
      slot: {
        sdk: {
          threads: {
            defaultExecutionOptions: async ({ threadId }: { threadId: string }) => {
              if (threadId === "b") throw new Error("no");
              return null;
            },
          },
        },
      },
    });
    await focusWithKeyboard(anchor("a"));
    expect(within(document.querySelector<HTMLElement>("[data-hover-card]")!).getAllByText("Not set")).toHaveLength(1);
    await focusWithKeyboard(anchor("b"));
    await flush();
    expect(within(document.querySelector<HTMLElement>("[data-hover-card]")!).getAllByText("Unavailable")).toHaveLength(1);
  });

  it("shows the branch's pull request with its attention state, in red when checks failed", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })], slot: { pullRequests: { env_main: available() }, sdk: models(null) } });
    await focusWithKeyboard(anchor("a"));
    const section = document.querySelector<HTMLElement>("[data-section=pull-request]")!;
    expect(section.textContent).toContain("#7");
    expect(section.textContent).toContain("Add shelves");
    expect(section.textContent).toContain("Checks failing · Review requested · Mergeable");
    const label = section.querySelector<HTMLElement>("[data-pull-request-label]")!;
    expect(label.textContent).toBe("Checks failed");
    expect(label.className).toContain("var(--tg-failed)");
    expect(section.querySelector<HTMLAnchorElement>("a")!.href).toBe("https://example.test/pr/7");
  });

  it("has no pull request section for a branch without one", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })], slot: { sdk: models(null) } });
    await focusWithKeyboard(anchor("a"));
    expect(cards()).toHaveLength(1);
    expect(document.querySelector("[data-section=pull-request]")).toBeNull();
  });

  it("shows one card at a time", async () => {
    await mount({ threads: [makeThread({ id: "a", title: "First", ...fresh }), makeThread({ id: "b", title: "Second", ...fresh })], slot: { sdk: models(null) } });
    await focusWithKeyboard(anchor("a"));
    await focusWithKeyboard(anchor("b"));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.textContent).toContain("Second");
  });

  it("lists the direct children under Subthreads (N), each opening that child", async () => {
    const m = await mount({
      threads: [
        makeThread({ id: "p", ...fresh }),
        makeThread({ id: "c1", title: "One", parentThreadId: "p", ...fresh }),
        makeThread({ id: "c2", title: "Two", parentThreadId: "p", ...fresh }),
      ],
      slot: { sdk: models(null) },
    });
    await focusWithKeyboard(anchor("p"));
    const hover = document.querySelector<HTMLElement>("[data-hover-card]")!;
    fireEvent.click(within(hover).getByRole("button", { name: "Subthreads (2)" }));
    fireEvent.click(within(hover).getByRole("button", { name: "Two" }));
    expect(m.view.navigateCalls.at(-1)).toEqual({ method: "toThread", threadId: "c2" });
  });

  it("opens 250 ms after the pointer enters and closes 300 ms after it leaves, and never for touch", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })], slot: { sdk: models(null) } });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerEnter(anchor("a"), { pointerType: "touch" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_000)));
    expect(cards()).toHaveLength(0);
    fireEvent.pointerEnter(anchor("a"), { pointerType: "mouse" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(249)));
    expect(cards()).toHaveLength(0);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(cards()).toHaveLength(1);
    fireEvent.pointerLeave(anchor("a"), { pointerType: "mouse" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(299)));
    expect(cards()).toHaveLength(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    await flush();
    expect(cards()).toHaveLength(0);
  });
});

describe("#330: pull requests from GitHub PR Status", () => {
  const badge = (id: string) => anchor(id).parentElement!.querySelector<HTMLAnchorElement>("[data-pull-request]");
  const section = () => document.querySelector("[data-section=pull-request]");

  it("AC2: shows a merged pull request as Merged on the card and in the hover card", async () => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })], slot: { pullRequests: { env_main: available({ state: "merged", attention: "merged" }) }, sdk: models(null) } });
    await flush();
    expect(badge("a")?.textContent).toBe("#7");
    expect(badge("a")?.getAttribute("aria-label")).toBe("Pull request #7, Merged: Add shelves");
    expect(badge("a")?.className).toContain("var(--tg-merged)");
    await focusWithKeyboard(anchor("a"));
    expect(section()?.textContent).toContain("#7 Add shelves");
    expect(section()?.querySelector("[data-pull-request-label]")?.textContent).toBe("Merged");
  });

  it("asks GitHub PR Status by each thread's environment", async () => {
    const { host } = await mount({
      threads: [makeThread({ id: "a", ...fresh, environment: { id: "env_x" } }), makeThread({ id: "b", ...fresh, environment: { id: "env_y" } })],
      slot: { pullRequests: { env_y: available() }, sdk: models(null) },
    });
    await flush();
    expect(badge("a")).toBeNull();
    expect(badge("b")?.textContent).toBe("#7");
    const asked = host.sdkCalls.filter((call) => call.method === "bb--github-pr-status.pullRequests").flatMap((call) => (call.args as { keys: string[] }).keys);
    expect(new Set(asked)).toEqual(new Set(["env_x", "env_y"]));
  });

  it.each([
    ["the lookup failed", { env_main: { outcome: "unavailable", message: "gh auth status failed: not logged in" } }],
    ["the row is out of shape", { env_main: { outcome: "available", pullRequest: { number: 7 } } }],
    ["the link is not a web address", { env_main: available({ url: "javascript:alert(1)" }) }],
    ["its attention state is one this version does not know", { env_main: available({ attention: "auto_merging" }) }],
    ["the workspace is gone", { env_main: { outcome: "unavailable", message: "Workspace path no longer exists: /tmp/tmp.qpn5eBNR89" } }],
    ["GitHub PR Status is disabled or absent", null],
  ] as const)("AC3: shows no badge and no hover card pull request when %s", async (_case, pullRequests) => {
    await mount({ threads: [makeThread({ id: "a", ...fresh })], slot: { pullRequests, sdk: models(null) } });
    await flush();
    expect(badge("a")).toBeNull();
    await focusWithKeyboard(anchor("a"));
    expect(cards()).toHaveLength(1);
    expect(section()).toBeNull();
  });

  it("asks nothing for a thread without an environment", async () => {
    const { host } = await mount({ threads: [makeThread({ id: "a", ...fresh, environment: null })], slot: { pullRequests: { env_main: available() }, sdk: models(null) } });
    await flush();
    expect(badge("a")).toBeNull();
    expect(host.sdkCalls.filter((call) => call.method === "bb--github-pr-status.pullRequests")).toEqual([]);
  });
});

describe("AC19: Jump hints", () => {
  const threads = () =>
    Array.from({ length: 11 }, (_, index) =>
      makeThread({ id: `t${index}`, title: `T${index}`, createdAt: NOW - (index + 1) * MIN, updatedAt: NOW - (index + 1) * MIN, latestAttentionAt: NOW - (index + 1) * MIN }),
    );
  const hints = () =>
    [...document.querySelectorAll("[data-jump-hint]")].map((hint) => ({ row: hint.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId, label: hint.textContent }));
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
  const shortcut = (n: number) => ({ label: `Ctrl + Shift + ${n}`, ariaKeyshortcuts: `Control+Shift+${n}` });

  it("shows on each row the jump key bb assigned it, in bb's label", async () => {
    // bb numbers the rows; a key it gives out of list order is still drawn on its own row.
    await mount({ threads: threads(), server: { order: threads().map((thread) => thread.id) }, slot: { sidebarShortcuts: { t0: shortcut(1), t1: shortcut(2), t3: shortcut(3) } } });
    expect(hints()).toEqual([
      { row: "t0", label: "Ctrl + Shift + 1" },
      { row: "t1", label: "Ctrl + Shift + 2" },
      { row: "t3", label: "Ctrl + Shift + 3" },
    ]);
    // The hint stands in place of the status; a row bb gave no key keeps its status.
    for (const id of ["t0", "t1", "t3"]) expect(card(id).querySelector("[data-status]")).toBeNull();
    expect(card("t2").querySelector("[data-status]")).not.toBeNull();
  });

  it("shows bb's label in place of a Slim row's status and shelf label", async () => {
    const DAY = 24 * 60 * MIN;
    const old = { createdAt: NOW - 5 * DAY, updatedAt: NOW - 4 * DAY, latestAttentionAt: NOW - 4 * DAY };
    await mount({
      threads: [makeThread({ id: "parked", ...old }), makeThread({ id: "settled", ...old }), makeThread({ id: "settled2", ...old })],
      server: { rows: { parked: parkedRow(NOW - 2 * DAY), settled: settledRow(NOW - DAY, "manual"), settled2: settledRow(NOW - DAY, "manual") }, settings: { inactiveShelf: false } },
      slot: { sidebarShortcuts: { parked: shortcut(1), settled: shortcut(2) } },
    });
    for (const label of ["Parked (1)", "Settled (2)"]) fireEvent.click(screen.getByRole("button", { name: label }));
    await flush();
    expect(hints()).toEqual([
      { row: "parked", label: "Ctrl + Shift + 1" },
      { row: "settled", label: "Ctrl + Shift + 2" },
    ]);
    expect(card("parked").getAttribute("data-card")).toBe("slim");
    expect(card("parked").textContent).not.toContain("2d");
    expect(card("settled").querySelector("[data-status]")).toBeNull();
    expect(card("settled2").querySelector("[data-status]")).not.toBeNull();
  });

  it("shows none while bb assigns none, whatever key is held", async () => {
    await mount({ threads: threads() });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_000)));
    expect(hints()).toEqual([]);
    expect(document.querySelectorAll("[data-status-slot]").length).toBeGreaterThan(0);
  });
});

describe("AC5: a card's clock menu", () => {
  const MONDAY_19 = new Date(2026, 9, 5, 19, 0, 0);

  async function openClockMenu() {
    const m = await mount({ threads: [makeThread({ id: "a", ...fresh })] });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(MONDAY_19);
    const trigger = screen.getByRole("button", { name: "Snooze Thread a" });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    });
    return { m, menu: screen.getByRole("menu") };
  }

  it("offers the presets, disables a time that has passed with its reason, and resolves Next week to next Monday 09:00", async () => {
    const { menu } = await openClockMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent!.split(/(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),)/)[0])).toEqual([
      "1 hour",
      "Wait refresh (5 hours)",
      "This evening",
      "Tomorrow morning",
      "Next week",
      "Pick date & time…",
      "Park thread",
    ]);
    const evening = within(menu).getByRole("menuitem", { name: /This evening/ });
    expect(evening.getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).getByRole("menuitem", { name: /Next week/ }).textContent).toContain("Mon, Oct 12, 9:00 AM");
    fireEvent.pointerMove(evening.parentElement!);
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(screen.getAllByText("Today's time has passed").length).toBeGreaterThan(0);
  });

  it("snoozes until a preset's time", async () => {
    const { m, menu } = await openClockMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /Tomorrow morning/ }));
    });
    await flush();
    const call = m.server.calls.find((entry) => entry.method === "snooze")!;
    expect(call.input).toEqual({ threadId: "a", until: new Date(2026, 9, 6, 9, 0, 0).getTime() });
  });

  it("asks for the Snooze until dialog from Pick date & time…", async () => {
    const asked: string[] = [];
    function Probe() {
      useSnoozePickerRequests((threadId) => asked.push(threadId));
      return null;
    }
    render(<Probe />);
    const { menu } = await openClockMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Pick date & time…" }));
    });
    expect(asked).toEqual(["a"]);
  });

  it("parks from the clock menu", async () => {
    const { m, menu } = await openClockMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Park thread" }));
    });
    await flush();
    expect(m.server.calls.some((entry) => entry.method === "park")).toBe(true);
  });
});
