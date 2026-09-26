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
      providers: { models: async () => ({ models: [] }) } as never,
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
        makeThread({ id: "m", title: "Parent" }),
        makeThread({ id: "c", title: "Worker", parentThreadId: "m", providerId: "codex", hasPendingInteraction: true }),
      ],
    );
    expect(
      await screen.findByRole("link", { name: "Open Worker — Needs your input; Codex; child of Parent" }),
    ).toBeTruthy();
  });

  it("scenario 1: Needs attention draws the blocked child's path, and the group header keeps its counter", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      ...[1, 2, 3, 4, 5].map((n) =>
        makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working, hasPendingInteraction: n === 2 }),
      ),
      makeThread({ id: "o", title: "Other" }),
    ]);
    const section = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(section).getByRole("link", { name: /Open Parent — .*; in Alpha/ })).toBeTruthy();
    expect(within(section).getByRole("link", { name: /Open Child 2/ })).toBeTruthy();
    expect(within(section).queryByRole("link", { name: /Open Child 1/ })).toBeNull();
    expect(within(section).getByText("+4 more")).toBeTruthy();
    expect(within(section).getByText("Alpha")).toBeTruthy();
    const project = screen.getByRole("region", { name: "Alpha" });
    expect(within(project).queryByRole("link", { name: /Open Parent/ })).toBeNull();
    expect(within(project).getByRole("link", { name: /Open Other/ })).toBeTruthy();
    expect(within(project).getByRole("group", { name: "1 waiting on you" })).toBeTruthy();
  });

  it("opens a family in Needs attention from its chip or +N more, and closes it back to the path", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      ...[1, 2, 3].map((n) =>
        makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working, hasPendingInteraction: n === 2 }),
      ),
    ]);
    const section = await screen.findByRole("region", { name: "Needs attention" });
    const chip = within(section).getByRole("button", { name: "Show 3 child threads of Parent, needs your input" });
    expect(chip.textContent).toContain("3");
    expect(within(section).queryByRole("link", { name: /Open Child 1/ })).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(within(section).getByRole("link", { name: /Open Child 1/ })).toBeTruthy());
    expect(within(section).getByRole("link", { name: /Open Child 3/ })).toBeTruthy();
    expect(within(section).queryByText("+2 more")).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: /Collapse 3 child threads of Parent/ }));
    await waitFor(() => expect(within(section).queryByRole("link", { name: /Open Child 1/ })).toBeNull());
    // Closed, the path to what needs attention stays.
    expect(within(section).getByRole("link", { name: /Open Child 2/ })).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Show 2 more child threads" }));
    await waitFor(() => expect(within(section).getByRole("link", { name: /Open Child 1/ })).toBeTruthy());
  });

  it("opens and closes a family from its chip", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      ...[1, 2].map((n) => makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working })),
    ]);
    const chip = await screen.findByRole("button", { name: /child threads of Parent, working/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain("2");
    expect(screen.queryByRole("link", { name: /Open Child 1/ })).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("link", { name: /Open Child 1/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Collapse 2 child threads of Parent/ }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Child 1/ })).toBeNull());
  });

  it("draws Needs attention first under the settings row, above Pinned, with no All / Needs attention filter", async () => {
    render([
      makeThread({ id: "a", title: "Busy", ...working }),
      makeThread({ id: "b", title: "Done", ...finishedUnread }),
      makeThread({ id: "p", title: "Pinned one", pinnedAt: T0, isPinned: true }),
    ]);
    await screen.findByRole("link", { name: /Open Done/ });
    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Needs attention", "Pinned", "Alpha", "Beta"]);
    expect(within(screen.getByRole("region", { name: "Needs attention" })).getByRole("link", { name: /Open Done/ })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Alpha" })).getByRole("link", { name: /Open Busy/ })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    // The section's own header is the only "Needs attention" on screen.
    expect(screen.getAllByText(/Needs attention/)).toHaveLength(1);
    // The settings row holds ⚙ alone, ahead of the section.
    const settings = screen.getByRole("button", { name: "Thread Glance settings" });
    expect(settings.parentElement!.children).toHaveLength(1);
    expect(settings.compareDocumentPosition(screen.getByRole("region", { name: "Needs attention" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws no Needs attention section, and no line for it, when nothing needs attention", async () => {
    render([makeThread({ id: "a", title: "Busy", ...working })]);
    await screen.findByRole("link", { name: /Open Busy/ });
    expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByText(/Needs attention|Nothing needs/)).toBeNull();
  });

  it("shows the whole list with Needs attention to someone whose saved view was the old Needs attention filter", async () => {
    localStorage.setItem("bb.thread-glance.client.v1", JSON.stringify({ filter: "attention", density: "comfortable" }));
    render([makeThread({ id: "a", title: "Busy", ...working }), makeThread({ id: "b", title: "Done", ...finishedUnread })]);
    expect(await screen.findByRole("link", { name: /Open Busy/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Needs attention" })).toBeTruthy();
  });

  it("gives the Needs attention header no collapse, menu or count other than its families", async () => {
    render(
      [
        makeThread({ id: "a", title: "Asks", hasPendingInteraction: true }),
        makeThread({ id: "b", title: "Also asks", projectId: "proj_b", hasPendingInteraction: true }),
      ],
      { prefs: { collapsedProjects: ["proj_a", "proj_b"] } },
    );
    const section = await screen.findByRole("region", { name: "Needs attention" });
    const header = within(section).getByRole("heading", { name: /Needs attention/ });
    expect(within(header).getByLabelText("2 families").textContent).toBe("2");
    expect(within(header).queryAllByRole("button")).toEqual([]);
    fireEvent.click(header);
    expect(within(section).getByRole("link", { name: /Open Asks/ })).toBeTruthy();
  });

  it("indents each level of a Needs attention path by one small step, and the grandchild carries its parent's name", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      makeThread({ id: "c", title: "Child", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", title: "Grandchild", parentThreadId: "c", createdAt: T0 + 2, hasPendingInteraction: true }),
    ]);
    const padding = async (name: RegExp) => (await screen.findByRole("link", { name })).parentElement!.style.paddingLeft;
    expect(await padding(/Open Parent/)).toBe("8px");
    expect(await padding(/Open Child/)).toBe("20px");
    expect(await padding(/Open Grandchild/)).toBe("32px");
    expect(screen.getByText("↳").getAttribute("title")).toBe("Child of Child");
  });

  it("opens one settings panel with no tabs, holding exactly the listed settings", async () => {
    render([makeThread({ id: "a", title: "Busy", ...working })]);
    fireEvent.click(await screen.findByRole("button", { name: "Thread Glance settings" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).queryByRole("tablist")).toBeNull();
    expect(within(panel).queryByRole("tab")).toBeNull();
    expect(within(panel).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["List", "Rows", "Show"]);
    const segments = within(panel)
      .getAllByRole("radiogroup")
      .map((group) => [group.getAttribute("aria-label"), within(group).getAllByRole("radio").map((radio) => radio.textContent)]);
    expect(segments).toEqual([
      ["Group by", ["Project", "Custom", "Machine"]],
      ["Sort by", ["Updated", "Created", "A–Z"]],
      ["Density", ["Compact", "Comfortable"]],
      ["Harness icon", ["Muted", "Colour", "Hidden"]],
      ["Threads", ["Active", "Archived", "Both"]],
    ]);
    const checkboxes = within(panel)
      .getAllByRole("checkbox")
      .map((box) => [box.textContent, box.getAttribute("aria-checked")]);
    expect(checkboxes).toEqual([
      ["Working threads first", "false"],
      ["Worktrees as foldersThreads sharing a worktree fold into one row", "false"],
      ["Collapse older threads", "true"],
      ["Pull request badge", "true"],
      ["Needs attention counts every child" + "Every unread or failed child thread; otherwise only those blocked on you.", "false"],
    ]);
    expect(within(panel).getByRole("button", { name: /Sort order: Newest first/ }).textContent).toBe("↓");
    // Nothing else: the radios, checkboxes and the arrow are every control.
    expect(within(panel).getAllByRole("radio")).toHaveLength(14);
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    expect(panel.querySelectorAll("button")).toHaveLength(14 + 5 + 1);
  });

  it("reverses every group with the ↓/↑ button, and saves Threads choices as lifecycles", async () => {
    const setPreference = vi.fn(({ key, value }: { key: string; value: unknown }) => ({ key, value }));
    const threads = [
      makeThread({ id: "a1", title: "A old", createdAt: T0, latestAttentionAt: T0 }),
      makeThread({ id: "a2", title: "A new", createdAt: T0 + 1, latestAttentionAt: T0 + 1, lastReadAt: T0 + 1 }),
      makeThread({ id: "b1", title: "B old", projectId: "proj_b", createdAt: T0, latestAttentionAt: T0 }),
      makeThread({ id: "b2", title: "B new", projectId: "proj_b", createdAt: T0 + 1, latestAttentionAt: T0 + 1, lastReadAt: T0 + 1 }),
    ];
    render(threads, { extra: { rpc: { ...rpc(), setPreference } as never } });
    const order = () => screen.getAllByRole("link").map((link) => link.getAttribute("aria-label")!.split(" — ")[0]);
    await screen.findByRole("link", { name: /Open A new/ });
    expect(order()).toEqual(["Open A new", "Open A old", "Open B new", "Open B old"]);
    fireEvent.click(screen.getByRole("button", { name: "Thread Glance settings" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: /Sort order: Newest first/ }));
    await waitFor(() => expect(order()).toEqual(["Open A old", "Open A new", "Open B old", "Open B new"]));
    expect(within(panel).getByRole("button", { name: /Sort order: Oldest first/ }).textContent).toBe("↑");
    const threadsGroup = within(panel).getByRole("radiogroup", { name: "Threads" });
    fireEvent.click(within(threadsGroup).getByRole("radio", { name: "Archived" }));
    fireEvent.click(within(threadsGroup).getByRole("radio", { name: "Both" }));
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith({ key: "threadLifecycles", value: ["active", "archived"] }));
    expect(setPreference).toHaveBeenCalledWith({ key: "sortDirection", value: "ascending" });
    expect(within(threadsGroup).getByRole("radio", { name: "Both" }).getAttribute("aria-checked")).toBe("true");
  });

  it("tints the child chip by the most urgent child state and draws unread in the accent", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      makeThread({ id: "c", title: "Busy child", parentThreadId: "m", createdAt: T0 + 1, ...working }),
      makeThread({ id: "u", title: "Fresh", ...finishedUnread }),
    ]);
    const chip = await screen.findByRole("button", { name: /child thread of Parent/ });
    expect(chip.getAttribute("data-tone")).toBe("working");
    const dot = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!.querySelector('span[class*="rounded-full"]');
    expect(dot?.className).toContain("--timeline-accent");
  });

  it("draws a ring screen readers skip in an idle row's Status column, and no ring in any other", async () => {
    render([
      makeThread({ id: "i", title: "Quiet" }),
      makeThread({ id: "u", title: "Fresh", ...finishedUnread }),
    ]);
    const column = async (name: RegExp) => (await screen.findByRole("link", { name })).nextElementSibling as HTMLElement;
    const idle = await column(/Open Quiet/);
    const ring = idle.querySelector('span[class*="rounded-full"]');
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(ring?.className).toContain("text-muted-foreground");
    expect(within(idle).queryAllByRole("img")).toEqual([]);
    const unread = await column(/Open Fresh/);
    expect(within(unread).getByRole("img", { name: "Unread" })).toBeTruthy();
    expect(unread.querySelector('[aria-hidden="true"]')).toBeNull();
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

  it("says so on an empty list, with no New thread button of its own", async () => {
    render([]);
    expect(await screen.findByText("No threads yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New thread/ })).toBeNull();
  });

  it("keeps New thread in a group's menu", async () => {
    render([makeThread({ id: "t" })]);
    const trigger = await screen.findByRole("button", { name: "Alpha actions" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    expect(await screen.findByRole("menuitem", { name: "New thread" })).toBeTruthy();
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
  it("writes why a thread needs attention under its row", async () => {
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

describe("row hover card", () => {
  const threads = [
    makeThread({ id: "a", title: "Alpha row", updatedAt: T0 + 2, latestAttentionAt: T0 + 2 }),
    makeThread({ id: "b", title: "Beta row", updatedAt: T0 + 1, latestAttentionAt: T0 + 1 }),
  ];
  const rowOf = async (title: string) => (await screen.findByRole("link", { name: new RegExp(`Open ${title}`) })).parentElement!;
  const card = () => screen.queryByText("Harness");
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  const withTimers = async (test: () => Promise<void>) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await test();
    } finally {
      vi.useRealTimers();
    }
  };
  const enter = (row: HTMLElement, x = 10, y = 10) => fireEvent.pointerEnter(row, { pointerType: "mouse", clientX: x, clientY: y });
  const move = (row: HTMLElement, x = 14, y = 10) => fireEvent.pointerMove(row, { pointerType: "mouse", clientX: x, clientY: y });

  it("opens once the pointer moves over a row", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
      move(beta);
      await wait(600);
      expect(card()).not.toBeNull();
    }));

  it("does not open for a row that slides under a still pointer", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
      await wait(600);
      expect(card()).toBeNull();
      // A move event that doesn't leave the entry point is not a move.
      move(beta, 10, 10);
      await wait(600);
      expect(card()).toBeNull();
    }));

  it("opens on focus a key brought, not on focus a press or the page put there", () =>
    withTimers(async () => {
      render(threads);
      const link = await screen.findByRole("link", { name: /Open Beta row/ });
      act(() => link.focus());
      await wait(600);
      expect(card()).toBeNull();
      act(() => link.blur());
      fireEvent.keyDown(document.body, { key: "Tab" });
      act(() => link.focus());
      await wait(600);
      expect(card()).not.toBeNull();
    }));

  it("stays open while the pointer is on the card, and closes once it leaves", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
      move(beta);
      await wait(600);
      const content = card()!.closest<HTMLElement>("[data-side]")!;
      fireEvent.pointerLeave(beta, { pointerType: "mouse" });
      fireEvent.pointerEnter(content, { pointerType: "mouse" });
      await wait(300);
      expect(card()).not.toBeNull();
      fireEvent.pointerLeave(content, { pointerType: "mouse" });
      await wait(300);
      expect(card()).toBeNull();
    }));

  it("opens nothing for a touch", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      fireEvent.pointerEnter(beta, { pointerType: "touch", clientX: 10, clientY: 10 });
      fireEvent.pointerMove(beta, { pointerType: "touch", clientX: 14, clientY: 10 });
      await wait(600);
      expect(card()).toBeNull();
    }));

  it("closes a card that focus opened when focus leaves, and one focus spends the key", () =>
    withTimers(async () => {
      render(threads);
      const link = await screen.findByRole("link", { name: /Open Beta row/ });
      fireEvent.keyDown(document.body, { key: "Tab" });
      act(() => link.focus());
      await wait(600);
      expect(card()).not.toBeNull();
      act(() => link.blur());
      await wait(300);
      expect(card()).toBeNull();
      act(() => link.focus());
      await wait(600);
      expect(card()).toBeNull();
    }));

  it("does not come back after the row's menu closes", () =>
    withTimers(async () => {
      render(threads);
      const link = await screen.findByRole("link", { name: /Open Beta row/ });
      fireEvent.keyDown(document.body, { key: "Tab" });
      act(() => link.focus());
      await wait(600);
      expect(card()).not.toBeNull();
      const actions = within(link.parentElement!).getByRole("button", { name: "Thread actions" });
      fireEvent.keyDown(actions, { key: "Enter" });
      await wait(50);
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await wait(600);
      expect(screen.queryByRole("menu")).toBeNull();
      expect(card()).toBeNull();
    }));

  it("drops a pending open on a press anywhere", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
      move(beta);
      await wait(200);
      fireEvent.pointerDown(document.body);
      await wait(600);
      expect(card()).toBeNull();
    }));

  it("drops a pending open on navigation", () =>
    withTimers(async () => {
      const slot = render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
      move(beta);
      await wait(200);
      const List = app.threadLists[0]!.component;
      slot.lifecycle.rerender(<List {...props} activeThreadId="a" />);
      await wait(600);
      expect(card()).toBeNull();
    }));

  it("does not open for the previous active row after navigating away from it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const slot = render(threads, { props: { activeThreadId: "a" } });
      const alpha = await rowOf("Alpha row");
      fireEvent.pointerEnter(alpha, { pointerType: "mouse" });
      fireEvent.pointerMove(alpha, { pointerType: "mouse" });
      await wait(700);
      fireEvent.pointerLeave(alpha, { pointerType: "mouse" });
      await wait(300);
      const List = app.threadLists[0]!.component;
      slot.lifecycle.rerender(<List {...props} activeThreadId="b" />);
      await wait(700);
      expect(card()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
