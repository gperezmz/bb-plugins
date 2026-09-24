// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import {
  finishedUnread,
  makeThread,
  PROJECTS,
  T0,
  working,
} from "@/features/thread-list/testing/fixtures";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  // jsdom lacks these; Radix and the windowing observer use them.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("./app"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const props: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate() {},
  searchQuery: "",
};

function rpc(
  prefs: Partial<Preferences> = {},
  stamps: Partial<Record<string, Record<string, number>>> = {},
  notes: Record<string, unknown> = {},
) {
  const preferences = { ...defaultPreferences(), ...prefs };
  return {
    listPreferences: () => ({ preferences }),
    setPreference: ({ key, value }: { key: string; value: unknown }) => ({ key, value }),
    resetPreference: ({ key }: { key: string }) => ({ key, value: null }),
    importPreferences: () => ({ status: "already-imported" as const, source: null, keys: [] }),
    listStamps: () => ({
      stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {}, ...stamps },
    }),
    markSeen: () => ({ at: Date.now() }),
    clearSeen: () => ({ ok: true as const }),
    listScheduled: () => ({ status: "ready" as const, scheduled: {} }),
    listNotes: () => ({ notes }),
  };
}

function render(
  threads: ReturnType<typeof makeThread>[],
  options: {
    prefs?: Partial<Preferences>;
    props?: Partial<PluginThreadListProps>;
    extra?: object;
    notes?: Record<string, unknown>;
  } = {},
) {
  return renderSlot(app.threadLists[0]!, { ...props, ...options.props }, {
    rpc: rpc(options.prefs, {}, options.notes) as never,
    sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
    providers: {
      status: "ready",
      providers: [
        { id: "claude-code", displayName: "Claude Code", logoUrl: null },
        { id: "codex", displayName: "Codex", logoUrl: null },
      ] as never,
    },
    sdk: {
      threads: { defaultExecutionOptions: async () => null, update: async () => ({}) } as never,
      projects: { branches: async () => ({ defaultBranch: "main" }) } as never,
    },
    ...options.extra,
  });
}

describe("Thread Glance slot", () => {
  it("registers one thread list", () => {
    expect(app.threadLists.map((list) => list.id)).toEqual(["thread-glance"]);
  });

  it("shows a skeleton while threads load", async () => {
    renderSlot(app.threadLists[0]!, props, { rpc: rpc() as never, sidebarThreads: { status: "loading" } });
    expect(await screen.findByRole("status", { name: "Loading threads" })).toBeTruthy();
  });

  it("shows an error with Retry", async () => {
    renderSlot(app.threadLists[0]!, props, { rpc: rpc() as never, sidebarThreads: { status: "error" } });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("puts the host's keyboard contract on every row anchor", async () => {
    render([makeThread({ id: "t1" })], {
      extra: { sidebarShortcuts: { t1: { label: "⌘1", ariaKeyshortcuts: "Meta+1" } } },
    });
    const anchor = await screen.findByRole("link", { name: /Open Thread t1/ });
    expect(anchor.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(anchor.getAttribute("data-sidebar-thread-id")).toBe("t1");
    expect(anchor.getAttribute("aria-keyshortcuts")).toBe("Meta+1");
    expect(anchor.getAttribute("href")).toBe("/projects/proj_a/threads/t1");
  });

  it("names state, provider and parent in the row's accessible name", async () => {
    render(
      [
        makeThread({ id: "m", title: "Manager" }),
        makeThread({ id: "c", title: "Worker", parentThreadId: "m", providerId: "codex", hasPendingInteraction: true }),
      ],
    );
    expect(
      await screen.findByRole("link", { name: "Open Worker — Needs your input; Codex; child of Manager" }),
    ).toBeTruthy();
  });

  it("scenario 1: chip, counters and only the blocked child", async () => {
    render([
      makeThread({ id: "m", title: "Manager" }),
      ...[1, 2, 3, 4, 5].map((n) =>
        makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working, hasPendingInteraction: n === 2 }),
      ),
    ]);
    const chip = await screen.findByRole("button", { name: /child threads of Manager, needs your input/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain("5");
    expect(screen.getByRole("link", { name: /Open Child 2/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open Child 1/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show 4 more child threads" }).textContent).toBe("4 more child threads");
    // Rows show working, so the header keeps only what needs action.
    expect(screen.getByRole("group", { name: "1 needs you" })).toBeTruthy();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("link", { name: /Open Child 1/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Collapse 5 child threads of Manager/ }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Child 2/ })).toBeNull());
  });

  it("Needs attention keeps only what needs you", async () => {
    render([makeThread({ id: "a", title: "Busy", ...working }), makeThread({ id: "b", title: "Done", ...finishedUnread })]);
    await screen.findByRole("link", { name: /Open Busy/ });
    fireEvent.click(screen.getByRole("radio", { name: /Needs attention/ }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Busy/ })).toBeNull());
    expect(screen.getByRole("link", { name: /Open Done/ })).toBeTruthy();
  });

  it("indents each folded level by one small step, and the grandchild carries its parent's name", async () => {
    render([
      makeThread({ id: "m", title: "Manager" }),
      makeThread({ id: "c", title: "Child", parentThreadId: "m", createdAt: T0 + 1, hasPendingInteraction: true }),
      makeThread({ id: "g", title: "Grandchild", parentThreadId: "c", createdAt: T0 + 2, hasPendingInteraction: true }),
    ]);
    const padding = async (name: RegExp) => (await screen.findByRole("link", { name })).parentElement!.style.paddingLeft;
    expect(await padding(/Open Manager/)).toBe("8px");
    expect(await padding(/Open Child/)).toBe("20px");
    expect(await padding(/Open Grandchild/)).toBe("32px");
    expect(screen.getByText("↳").getAttribute("title")).toBe("Child of Child");
  });

  it("says so under an opened chip when Needs attention leaves nothing under it", async () => {
    render([
      makeThread({ id: "m", title: "Manager", hasPendingInteraction: true }),
      makeThread({ id: "c", title: "Quiet child", parentThreadId: "m", createdAt: T0 + 1 }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Show 1 child thread of Manager/ }));
    await screen.findByRole("link", { name: /Open Quiet child/ });
    fireEvent.click(screen.getByRole("radio", { name: /Needs attention/ }));
    expect(await screen.findByText("No child threads need attention")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open Quiet child/ })).toBeNull();
  });

  it("tints the child chip by the most urgent child state and draws unread in the accent", async () => {
    render([
      makeThread({ id: "m", title: "Manager" }),
      makeThread({ id: "c", title: "Blocked child", parentThreadId: "m", createdAt: T0 + 1, hasPendingInteraction: true }),
      makeThread({ id: "u", title: "Fresh", ...finishedUnread }),
    ]);
    const chip = await screen.findByRole("button", { name: /child thread of Manager/ });
    expect(chip.getAttribute("data-tone")).toBe("attention");
    const dot = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!.querySelector('span[class*="rounded-full"]');
    expect(dot?.className).toContain("--timeline-accent");
  });

  it("explains what Needs attention keeps, and only on that toggle", async () => {
    render([makeThread({ id: "a", title: "Busy", ...working })]);
    await screen.findByRole("link", { name: /Open Busy/ });
    const attention = screen.getByRole("radio", { name: /Needs attention/ });
    const description = attention.getAttribute("aria-description") ?? "";
    for (const kept of ["question", "approval", "plan review", "failed", "queued message", "offline", "child thread", "manager"]) {
      expect(description).toContain(kept);
    }
    expect(screen.getByRole("radio", { name: "All" }).hasAttribute("aria-description")).toBe(false);
  });

  it("marks read through the host's action from the row menu", async () => {
    const slot = render([makeThread({ id: "u", title: "Unread one", ...finishedUnread })]);
    const row = (await screen.findByRole("link", { name: /Open Unread one/ })).parentElement!;
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
    const item = await screen.findByRole("menuitem", { name: "Mark read" });
    fireEvent.click(item);
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toContainEqual(
        expect.objectContaining({ method: "setRead", threadId: "u", read: true }),
      ),
    );
  });

  it("the header + opens a new thread in its project", async () => {
    const slot = render([makeThread({ id: "t" })]);
    fireEvent.click(await screen.findByRole("button", { name: "New thread in Alpha" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({ method: "openNewThread", options: expect.objectContaining({ projectId: "proj_a", focusPrompt: true }) }),
    );
  });

  it("draws a two-letter mark for providers without a logo", async () => {
    render([makeThread({ id: "t", providerId: "codex" })]);
    const marks = await screen.findAllByRole("img", { name: "Codex" });
    expect(marks[0]!.textContent).toBe("CO");
  });

  it("collapsing a project persists through setPreference", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const slot = render([makeThread({ id: "t" })]);
      fireEvent.click(await screen.findByRole("button", { name: "Collapse Alpha section" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "setPreference", input: { key: "collapsedProjects", value: ["proj_a"] } }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("compact viewport", () => {
  it("keeps the harness and age visible beside an always-visible menu with Details", async () => {
    render([makeThread({ id: "t", title: "Phone row", providerId: "codex" })], { props: { isCompactViewport: true } });
    const anchor = await screen.findByRole("link", { name: /Open Phone row/ });
    const row = anchor.parentElement!;
    expect(within(row).getByRole("img", { name: "Codex" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Archive thread" })).toBeNull();
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "touch" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Details" })).toBeTruthy();
  });
});

describe("notes and moves", () => {
  it("writes why a thread needs you under its row", async () => {
    render([makeThread({ id: "q", title: "Asker", hasPendingInteraction: true })], {
      notes: { q: { pending: { kind: "approval", text: "rm -rf build/", at: T0 } } },
    });
    expect(await screen.findByText("rm -rf build/")).toBeTruthy();
    expect(screen.getByText("Approve:")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Asker — Needs approval/ })).toBeTruthy();
  });

  it("moves a thread from the keyboard with Move… (drag without a pointer)", async () => {
    const slot = render([
      makeThread({ id: "a", title: "Mover" }),
      makeThread({ id: "b", title: "New parent" }),
    ]);
    const row = (await screen.findByRole("link", { name: /Open Mover/ })).parentElement!;
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move…" }));
    const input = await screen.findByRole("combobox", { name: "Find a thread" });
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toContainEqual(
        expect.objectContaining({ method: "threads.update", args: [{ threadId: "a", parentThreadId: "b" }] }),
      ),
    );
  });
});

describe("context menu release guard", () => {
  it("ignores the release of the right-click, then accepts a press and click", async () => {
    const slot = render([makeThread({ id: "r", title: "Right clicked", ...finishedUnread })]);
    const anchor = await screen.findByRole("link", { name: /Open Right clicked/ });
    fireEvent.contextMenu(anchor.parentElement!, { clientX: 20, clientY: 20 });
    const item = await screen.findByRole("menuitem", { name: "Mark read" });
    fireEvent.click(item);
    expect(slot.inspection.sidebarActionCalls.some((call) => call.method === "setRead")).toBe(false);
    // However long the release took, only a new press in the menu chooses.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark read" }));
    expect(slot.inspection.sidebarActionCalls.some((call) => call.method === "setRead")).toBe(false);
    const again = screen.getByRole("menuitem", { name: "Mark read" });
    fireEvent.pointerDown(again, { button: 0, pointerType: "mouse" });
    fireEvent.click(again);
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "setRead", read: true })),
    );
  });
});

describe("context menu keyboard choice", () => {
  it("accepts an item chosen with the keyboard", async () => {
    const slot = render([makeThread({ id: "k", title: "Keyed", ...finishedUnread })]);
    const anchor = await screen.findByRole("link", { name: /Open Keyed/ });
    fireEvent.contextMenu(anchor.parentElement!, { clientX: 20, clientY: 20 });
    const item = await screen.findByRole("menuitem", { name: "Mark read" });
    fireEvent.keyDown(item, { key: "ArrowDown" });
    fireEvent.click(item);
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "setRead", read: true })),
    );
  });
});
