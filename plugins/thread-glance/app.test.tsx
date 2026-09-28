// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/signals";
import manifest from "./package.json";
import {
  failedUnread,
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
  // The fixtures' threads are months old by the real clock: nothing settles unless a test asks.
  const preferences = { ...defaultPreferences(), settleAfter: "never" as const, ...prefs };
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
    stamps?: Partial<Record<string, Record<string, number>>>;
  } = {},
) {
  return renderSlot(app.threadLists[0]!, { ...props, ...options.props }, {
    rpc: rpc(options.prefs, options.stamps, options.notes) as never,
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
      projects: {
        get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
        branches: async () => ({ defaultBranch: "main" }),
      } as never,
      providers: { models: async () => ({ models: [] }) } as never,
      system: {
        config: async () => ({
          primaryHostId: "host_1",
          generalSettings: { defaultProviderId: null },
          serverAccess: { defaultProviderId: "claude-code" },
        }),
      } as never,
    },
    ...options.extra,
  });
}

/** Opens the settings panel from the list header of the list on screen, and returns it. */
async function openSettings(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Thread Glance settings" }));
  return screen.findByRole("dialog");
}

describe("Thread Glance slot", () => {
  it("registers one thread list", () => {
    expect(app.threadLists.map((list) => list.id)).toEqual(["thread-glance"]);
  });

  it("puts nothing in bb's sidebar footer", () => {
    expect(app.experimentalSidebarFooterItems).toEqual([]);
    expect(app.sidebarFooterActions).toEqual([]);
    expect(manifest.bb.branding.icon).toBe("ListView");
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

  it("scenario 1: a tree whose child waits on you stays in its group, with the child's path revealed and its header counting it", async () => {
    render([
      makeThread({ id: "m", title: "Parent", latestAttentionAt: T0 + 10, lastReadAt: T0 + 10 }),
      ...[1, 2, 3, 4, 5].map((n) =>
        makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working, hasPendingInteraction: n === 2 }),
      ),
      makeThread({ id: "o", title: "Other" }),
    ]);
    const project = await screen.findByRole("region", { name: "Alpha" });
    await within(project).findByRole("link", { name: /Open Child 2/ });
    const links = within(project)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label")!.replace(/^Open (.*?) —.*$/, "$1"));
    expect(links).toEqual(["Parent", "Child 2", "Other"]);
    expect(within(project).getByRole("group", { name: "1 waiting on you" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  });

  it("opens and closes a tree from its chip", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      ...[1, 2].map((n) => makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working })),
    ]);
    const chip = await screen.findByRole("button", { name: "Show 2 child threads of Parent" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.textContent).toContain("2");
    expect(screen.queryByRole("link", { name: /Open Child 1/ })).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("link", { name: /Open Child 1/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Collapse 2 child threads of Parent/ }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Child 1/ })).toBeNull());
  });

  it("draws no Needs attention section: a thread that needs attention stays in its group", async () => {
    render([
      makeThread({ id: "a", title: "Busy", ...working }),
      makeThread({ id: "b", title: "Done", ...finishedUnread }),
      makeThread({ id: "p", title: "Pinned one", pinnedAt: T0, isPinned: true }),
    ]);
    await screen.findByRole("link", { name: /Open Done/ });
    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Pinned", "Alpha", "Beta"]);
    expect(within(screen.getByRole("region", { name: "Alpha" })).getByRole("link", { name: /Open Done/ })).toBeTruthy();
    expect(screen.queryByText(/Needs attention/)).toBeNull();
  });

  it("keeps drawing a collapsed group's trees that need attention under its header, and nothing else", async () => {
    render(
      [
        makeThread({ id: "a", title: "Asks", hasPendingInteraction: true }),
        makeThread({ id: "q", title: "Quiet" }),
        makeThread({ id: "b", title: "Also asks", projectId: "proj_b", hasPendingInteraction: true }),
      ],
      { prefs: { collapsedProjects: ["proj_a", "proj_b"] } },
    );
    const alpha = await screen.findByRole("region", { name: "Alpha" });
    expect(await within(alpha).findByRole("link", { name: /Open Asks/ })).toBeTruthy();
    expect(within(alpha).queryByRole("link", { name: /Open Quiet/ })).toBeNull();
    expect(within(alpha).getByRole("button", { name: "Expand Alpha section" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Beta" })).getByRole("link", { name: /Open Also asks/ })).toBeTruthy();
  });

  it("indents each level of a revealed path by one small step, and the grandchild carries its parent's name", async () => {
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

  it("starts the list at the list header, naming the grouping without acting on a click, in every grouping and viewport", async () => {
    for (const [organizationMode, name] of [
      ["project", "Projects"],
      ["chronological", "Sections"],
      ["machine", "Machines"],
    ] as const) {
      for (const isCompactViewport of [false, true]) {
        const { container } = render([makeThread({ id: "a", title: "Busy", ...working })], {
          prefs: { organizationMode },
          props: { isCompactViewport },
        });
        await screen.findByRole("link", { name: /Open Busy/ });
        const header = container.firstElementChild!.firstElementChild as HTMLElement;
        expect(header.getAttribute("data-sidebar")).toBe("list-header");
        const heading = within(header).getByRole("heading", { name });
        expect(heading.closest("button, a")).toBeNull();
        fireEvent.click(heading);
        expect(within(header).getByRole("heading", { name })).toBe(heading);
        cleanup();
      }
    }
  });

  it("opens one settings panel with no tabs, holding exactly the listed settings", async () => {
    render([makeThread({ id: "a" })]);
    const panel = await openSettings();
    await within(panel).findByRole("heading", { name: "List" });
    expect(within(panel).queryByRole("tablist")).toBeNull();
    expect(within(panel).queryByRole("tab")).toBeNull();
    expect(within(panel).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["List", "Rows", "Attention"]);
    const segments = within(panel)
      .getAllByRole("radiogroup")
      .map((group) => [group.getAttribute("aria-label"), within(group).getAllByRole("radio").map((radio) => radio.textContent)]);
    expect(segments).toEqual([
      ["Group by", ["Project", "Custom", "Machine"]],
      ["Sort by", ["Updated", "Created", "A–Z"]],
      ["Settle after", ["12h", "1d", "3d", "1w", "Never"]],
      ["Density", ["Compact", "Comfortable"]],
      ["Harness icon", ["Muted", "Colour"]],
    ]);
    const checkboxes = within(panel)
      .getAllByRole("checkbox")
      .map((box) => [box.textContent, box.getAttribute("aria-checked")]);
    expect(checkboxes).toEqual([
      ["Worktrees as foldersThreads sharing a worktree fold into one row", "false"],
      ["Needs attention counts every child" + "Every unread or failed child thread; otherwise only those blocked on you.", "false"],
    ]);
    expect(within(panel).getByRole("button", { name: /Sort order: Newest first/ }).textContent).toBe("↓");
    // Nothing else: the radios, checkboxes and the arrow are every control.
    expect(within(panel).getAllByRole("radio")).toHaveLength(15);
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    expect(panel.querySelectorAll("button")).toHaveLength(15 + 2 + 1);
  });

  it("reverses every group with the ↓/↑ button", async () => {
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
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole("button", { name: /Sort order: Newest first/ }));
    await waitFor(() => expect(order()).toEqual(["Open A old", "Open A new", "Open B old", "Open B new"]));
    expect(within(panel).getByRole("button", { name: /Sort order: Oldest first/ }).textContent).toBe("↑");
    await waitFor(() => expect(setPreference).toHaveBeenCalledWith({ key: "sortDirection", value: "ascending" }));
  });

  it("keeps a change made in the panel when the list hears the old value before the write goes out", async () => {
    const threads = [
      makeThread({ id: "a1", title: "A old", createdAt: T0, latestAttentionAt: T0 }),
      makeThread({ id: "a2", title: "A new", createdAt: T0 + 1, latestAttentionAt: T0 + 1, lastReadAt: T0 + 1 }),
    ];
    const list = render(threads);
    const order = () => screen.getAllByRole("link").map((link) => link.getAttribute("aria-label")!.split(" — ")[0]);
    await screen.findByRole("link", { name: /Open A new/ });
    const panel = await openSettings();
    fireEvent.click(within(panel).getByRole("button", { name: /Sort order: Newest first/ }));
    await waitFor(() => expect(order()).toEqual(["Open A old", "Open A new"]));
    await list.emitRealtime(CHANNELS.preferences, { key: "sortDirection", value: "default" });
    expect(order()).toEqual(["Open A old", "Open A new"]);
  });

  it("applies a density picked in the panel to the list at once, and keeps it for the next list", async () => {
    // Comfortable rows add a second line, here the branch.
    const threads = [makeThread({ id: "a", title: "Busy", ...working, environment: { branchName: "feature" } })];
    render(threads);
    const row = () => screen.getAllByRole("link", { name: /Open Busy/ })[0]!.parentElement!;
    await screen.findByRole("link", { name: /Open Busy/ });
    const compact = row().textContent;
    const panel = await openSettings();
    fireEvent.click(within(within(panel).getByRole("radiogroup", { name: "Density" })).getByRole("radio", { name: "Comfortable" }));
    await waitFor(() => expect(row().textContent).not.toBe(compact));
    const comfortable = row().textContent;
    expect(comfortable).toContain("feature");
    cleanup();
    render(threads);
    await screen.findByRole("link", { name: /Open Busy/ });
    expect(row().textContent).toBe(comfortable);
  });

  it("finds the default branch through the project's default source, and draws no branch line until it knows it", async () => {
    localStorage.setItem("bb.thread-glance.client.v1", JSON.stringify({ density: "comfortable" }));
    const asked: string[] = [];
    let answer: (value: { defaultBranch: string }) => void = () => undefined;
    const threads = [
      makeThread({ id: "a", title: "Trunk", host: { id: "host_2", name: "work" }, environment: { branchName: "main" } }),
      makeThread({ id: "b", title: "Topic", host: { id: "host_2", name: "work" }, environment: { branchName: "fix/login" } }),
    ];
    render(threads, {
      extra: {
        sdk: {
          threads: { defaultExecutionOptions: async () => null } as never,
          providers: { models: async () => ({ models: [] }) } as never,
          projects: {
            get: async () => ({ sources: [{ hostId: "host_2", isDefault: false }, { hostId: "host_1", isDefault: true }] }),
            branches: ({ hostId }: { hostId: string }) => {
              asked.push(hostId);
              return new Promise((resolve) => (answer = resolve));
            },
          } as never,
        },
      },
    });
    const row = async (name: RegExp) => (await screen.findByRole("link", { name })).parentElement!;
    await waitFor(() => expect(asked).toEqual(["host_1"]));
    expect((await row(/Open Topic/)).textContent).not.toContain("fix/login");
    expect((await row(/Open Trunk/)).textContent).not.toContain("main");
    await act(async () => answer({ defaultBranch: "main" }));
    await waitFor(async () => expect((await row(/Open Topic/)).textContent).toContain("fix/login"));
    expect((await row(/Open Trunk/)).textContent).not.toContain("main");
  });

  it("draws a muted chip with a count and chevron only, a grey child dot on a glyph taken from the tree, and unread in the accent", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      makeThread({ id: "c", title: "Busy child", parentThreadId: "m", createdAt: T0 + 1, ...working, providerId: "codex" }),
      makeThread({ id: "u", title: "Fresh", ...finishedUnread }),
    ]);
    const chip = await screen.findByRole("button", { name: "Show 1 child thread of Parent" });
    expect(chip.textContent).toBe("1");
    expect(chip.className).not.toMatch(/(^|\s)border(\s|-)/);
    expect(chip.className).not.toMatch(/(^|\s)bg-/);
    expect(within(chip).queryByRole("img")).toBeNull();
    const parent = await screen.findByRole("link", { name: /Open Parent — Working, in child threads; idle;/ });
    const column = parent.nextElementSibling as HTMLElement;
    expect(column.querySelector("[data-child-dot]")?.className).toContain("bg-muted-foreground");
    expect(column.querySelector("[data-child-dot]")?.className).not.toContain("--timeline-accent");
    const dot = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!.querySelector('span[class*="rounded-full"]');
    expect(dot?.className).toContain("--timeline-accent");
  });

  it("puts the pull request badge after the branch in Comfortable, on the title line in Compact, and names another machine beside the age", async () => {
    const threads = [
      makeThread({ id: "b", title: "Topic", environment: { branchName: "fix/login" }, host: { id: "host_2", name: "work" } }),
    ];
    const extra = { sidebarPullRequests: { b: { number: 7, title: "Fix", url: "u", state: "open", attention: "none" } } };
    render(threads, { extra });
    const anchor = await screen.findByRole("link", { name: /Open Topic/ });
    const row = anchor.parentElement!;
    const badge = await within(row).findByLabelText(/Pull request #7/);
    // Compact: one line, the badge beside the title, and no branch.
    expect(row.textContent).not.toContain("fix/login");
    expect(within(row).getByLabelText("On work").textContent).toBe("work");
    expect(within(row).getByLabelText(/ago|now/)).toBeTruthy();
    expect(badge.closest("span.flex-col")).toBeNull();
    cleanup();
    localStorage.setItem("bb.thread-glance.client.v1", JSON.stringify({ density: "comfortable" }));
    render(threads, { extra });
    const comfortable = (await screen.findByRole("link", { name: /Open Topic/ })).parentElement!;
    await waitFor(() => expect(comfortable.textContent).toContain("fix/login"));
    const line = within(comfortable).getByText("fix/login").closest("span.text-xs")!;
    expect(within(line as HTMLElement).getByLabelText(/Pull request #7/)).toBeTruthy();
    expect(within(comfortable).getAllByLabelText(/Pull request #7/)).toHaveLength(1);
    expect(within(comfortable).getByLabelText("On work")).toBeTruthy();
  });

  it("keeps the pull request badge on the title line of a Comfortable row whose second line is a note", async () => {
    localStorage.setItem("bb.thread-glance.client.v1", JSON.stringify({ density: "comfortable" }));
    render(
      [makeThread({ id: "f", title: "Broke", status: "error", environment: { branchName: "fix/y" } })],
      {
        notes: { f: { failed: { kind: "failed", text: "timeout", at: T0 } } },
        extra: { sidebarPullRequests: { f: { number: 9, title: "Y", url: "u", state: "open", attention: "none" } } },
      },
    );
    const row = (await screen.findByRole("link", { name: /Open Broke/ })).parentElement!;
    const badge = await within(row).findByLabelText(/Pull request #9/);
    const title = within(row).getByTitle("Broke");
    expect(badge.parentElement).toBe(title.parentElement);
    expect(row.textContent).toContain("Failed: timeout");
    expect(row.textContent).not.toContain("fix/y");
  });

  it("draws a harness icon only where it differs, in the Muted or Colour style the panel picks", async () => {
    render([
      makeThread({ id: "d", title: "Default root" }),
      makeThread({ id: "x", title: "Codex root", providerId: "codex" }),
      makeThread({ id: "c", title: "Codex child", parentThreadId: "d", providerId: "codex", createdAt: T0 + 1 }),
      makeThread({ id: "s", title: "Same child", parentThreadId: "d", createdAt: T0 + 2 }),
    ], { prefs: { expandedChildren: ["d"] } });
    const icon = async (name: RegExp) => within((await screen.findByRole("link", { name })).parentElement!).queryByRole("img", { name: /Codex|Claude Code/ });
    expect(await icon(/Open Default root/)).toBeNull();
    expect(await icon(/Open Same child/)).toBeNull();
    expect(await icon(/Open Codex root/)).toBeTruthy();
    expect(await icon(/Open Codex child/)).toBeTruthy();
    expect((await icon(/Open Codex root/))!.className).toContain("opacity-60");
    const panel = await openSettings();
    fireEvent.click(within(within(panel).getByRole("radiogroup", { name: "Harness icon" })).getByRole("radio", { name: "Colour" }));
    await waitFor(async () => expect((await icon(/Open Codex root/))!.className).not.toContain("opacity-60"));
    expect((await icon(/Open Codex child/))!.className).not.toContain("opacity-60");
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

  it("offers Mark read beside archive on a root whose tree holds something unread, and marks the whole tree read", async () => {
    const slot = render([
      makeThread({ id: "r", title: "Root" }),
      makeThread({ id: "c", title: "Child", parentThreadId: "r", createdAt: T0 + 1, ...finishedUnread }),
      makeThread({ id: "d", title: "Done child", parentThreadId: "r", createdAt: T0 + 2 }),
      makeThread({ id: "q", title: "Calm" }),
    ], { stamps: { finishedAt: { d: T0 + 50 } } });
    const row = (await screen.findByRole("link", { name: /Open Root/ })).parentElement!;
    const calm = (await screen.findByRole("link", { name: /Open Calm/ })).parentElement!;
    expect(within(calm).queryByRole("button", { name: "Mark read" })).toBeNull();
    const button = within(row).getByRole("button", { name: "Mark read" });
    expect(button.nextElementSibling?.getAttribute("aria-label")).toBe("Archive thread");
    fireEvent.click(button);
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls.filter((call) => call.method === "setRead").map((call) => (call as { threadId: string }).threadId).sort()).toEqual(["c", "d"]),
    );
    expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "markSeen", input: { threadIds: ["d"] } }));
  });

  it("offers Mark read for the tree in a root's menu whenever something in it is unread", async () => {
    const slot = render([
      makeThread({ id: "r", title: "Root" }),
      makeThread({ id: "c", title: "Child", parentThreadId: "r", createdAt: T0 + 1, ...finishedUnread }),
    ]);
    const row = (await screen.findByRole("link", { name: /Open Root/ })).parentElement!;
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark read" }));
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "setRead", threadId: "c", read: true })),
    );
  });

  it("draws no Mark read hover action on a phone", async () => {
    render([makeThread({ id: "u", title: "Fresh", ...finishedUnread })], { props: { isCompactViewport: true } });
    const row = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!;
    expect(within(row).queryByRole("button", { name: "Mark read" })).toBeNull();
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

  it("folds settled trees behind a faint Settled (N) divider, and saves its opening on the server", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const slot = render(
        [
          makeThread({ id: "live", title: "Live", createdAt: Date.now(), latestAttentionAt: Date.now(), lastReadAt: Date.now() }),
          makeThread({ id: "old", title: "Old" }),
          makeThread({ id: "merged", title: "Merged", createdAt: Date.now(), latestAttentionAt: Date.now(), lastReadAt: Date.now(), environment: { branchName: "fix/x" } }),
        ],
        {
          prefs: { settleAfter: "1d" },
          extra: { sidebarPullRequests: { merged: { number: 7, title: "Fix", url: "u", state: "merged", attention: "merged" } } },
        },
      );
      const fold = await screen.findByRole("button", { name: "Show 2 settled thread trees" });
      expect(fold.textContent).toBe("Settled (2)");
      expect(fold.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByRole("link", { name: /Open Live/ })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /Open Old/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Open Merged/ })).toBeNull();
      expect(screen.queryByText(/older/)).toBeNull();
      fireEvent.click(fold);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("button", { name: "Hide 2 settled thread trees" }).textContent).toBe("Settled");
      expect(screen.getByRole("link", { name: /Open Old/ })).toBeTruthy();
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "setPreference", input: { key: "openSettledFolds", value: ["project:proj_a"] } }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves Show archived threads from a group's menu as showArchived, for every group", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const slot = render([makeThread({ id: "t" })]);
      fireEvent.pointerDown(await screen.findByRole("button", { name: "Alpha actions" }), { button: 0, ctrlKey: false });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Show archived threads" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "setPreference", input: { key: "showArchived", value: true } }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only what needs you while the need-you filter is on, and drops the filter when nothing does", async () => {
    const threads = [
      makeThread({ id: "a", title: "Asks", hasPendingInteraction: true }),
      makeThread({ id: "q", title: "Quiet" }),
      makeThread({ id: "b", title: "Hidden asks", projectId: "proj_b", hasPendingInteraction: true }),
    ];
    render(threads, { prefs: { hiddenGroups: ["project:proj_b"] } });
    const filter = await screen.findByRole("button", { name: "2 need you" });
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("link", { name: /Open Hidden asks/ })).toBeNull();
    fireEvent.click(filter);
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Quiet/ })).toBeNull());
    expect(within(screen.getByRole("region", { name: "Alpha" })).getByRole("link", { name: /Open Asks/ })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Beta" })).getByRole("link", { name: /Open Hidden asks/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 need you" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Open Quiet/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "2 need you" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Quiet/ })).toBeNull());
  });

  it("draws no need-you filter when nothing needs you", async () => {
    render([makeThread({ id: "q", title: "Quiet" })]);
    await screen.findByRole("link", { name: /Open Quiet/ });
    expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
  });

  it("marks every unread thread in the list read from the header, hidden groups included, asking first above 20", async () => {
    const few = [
      makeThread({ id: "u1", title: "U1", ...finishedUnread }),
      makeThread({ id: "u2", title: "U2", projectId: "proj_b", ...finishedUnread }),
      makeThread({ id: "c", title: "C", parentThreadId: "u1", createdAt: T0 + 1, ...finishedUnread }),
    ];
    const slot = render(few, { prefs: { hiddenGroups: ["project:proj_b"] } });
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls.filter((call) => call.method === "setRead").map((call) => (call as { threadId: string }).threadId).sort()).toEqual(["c", "u1", "u2"]),
    );
    cleanup();
    const many = Array.from({ length: 21 }, (_, n) => makeThread({ id: `m${n}`, title: `M${n}`, ...finishedUnread }));
    const big = render(many);
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Mark 21 threads read?")).toBeTruthy();
    expect(big.inspection.sidebarActionCalls.filter((call) => call.method === "setRead")).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(big.inspection.sidebarActionCalls.filter((call) => call.method === "setRead")).toHaveLength(21));
  });

  it("opens the settings panel under the header from the settings button, and closes it with the same button", async () => {
    render([makeThread({ id: "a" })]);
    const button = await screen.findByRole("button", { name: "Thread Glance settings" });
    fireEvent.click(button);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

describe("a parent's glyph, child dot and children chip", () => {
  const parent = (overrides: object = {}) => makeThread({ id: "p", title: "Parent", ...overrides });
  const child = (id: string, overrides: object = {}, parentId = "p") =>
    makeThread({ id, title: `Child ${id}`, parentThreadId: parentId, createdAt: T0 + id.length, ...overrides });
  const offline = { status: "active", runtimeStatus: "waiting-for-host" } as const;

  interface Shown {
    /** The state the glyph and the row's label give. */
    state: string;
    dot: boolean;
  }
  interface Tree {
    name: string;
    threads: ReturnType<typeof makeThread>[];
    collapsed: Shown;
    expanded: Shown;
    chip: { count: number; unread: number };
    bold: boolean;
  }
  const own = (state: string): Shown => ({ state, dot: false });
  const fromTree = (state: string): Shown => ({ state, dot: true });

  const TREES: Tree[] = [
    {
      name: "parent idle, child working",
      threads: [parent(), child("c", working)],
      collapsed: fromTree("Working, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      name: "parent unread, child quiet",
      threads: [parent(finishedUnread), child("c")],
      collapsed: own("Unread"),
      expanded: own("Unread"),
      chip: { count: 1, unread: 0 },
      bold: true,
    },
    {
      name: "parent unread, child unread",
      threads: [parent(finishedUnread), child("c", finishedUnread)],
      collapsed: own("Unread"),
      expanded: own("Unread"),
      chip: { count: 1, unread: 1 },
      bold: true,
    },
    {
      name: "parent working, child unread",
      threads: [parent(working), child("c", finishedUnread)],
      collapsed: own("Working"),
      expanded: own("Working"),
      chip: { count: 1, unread: 1 },
      bold: false,
    },
    {
      name: "parent idle, child failed",
      threads: [parent(), child("c", failedUnread)],
      collapsed: fromTree("Failed, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 1 },
      bold: false,
    },
    {
      name: "parent idle, grandchild waits on you, child idle",
      threads: [parent(), child("c"), child("gg", { hasPendingInteraction: true }, "c")],
      collapsed: fromTree("Needs your input, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      // A quiet visible child gives the parent its chip.
      name: "parent idle, hidden child working",
      threads: [parent(), child("c"), child("hh", { ...working, isHidden: true })],
      collapsed: own("Idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      name: "parent idle, hidden child unread",
      threads: [parent(), child("c"), child("hh", { ...finishedUnread, isHidden: true })],
      collapsed: own("Idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      name: "parent idle, child offline",
      threads: [parent(), child("c", offline)],
      collapsed: fromTree("Machine offline, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      name: "parent idle, child's queued message failed",
      threads: [parent(), child("c", { queuedWork: "failed" })],
      collapsed: fromTree("Queued message failed, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 0 },
      bold: false,
    },
    {
      name: "parent idle, child unread",
      threads: [parent(), child("c", finishedUnread)],
      collapsed: fromTree("Unread, in child threads; idle"),
      expanded: own("Idle"),
      chip: { count: 1, unread: 1 },
      bold: false,
    },
  ];

  /** What a person reads off the parent's row. */
  async function parentRow() {
    const link = await screen.findByRole("link", { name: /^Open Parent — / });
    const row = link.parentElement!;
    const column = link.nextElementSibling as HTMLElement;
    const chip = within(row).getByRole("button", { name: /child threads? of Parent/ });
    return {
      label: link.getAttribute("aria-label"),
      glyph: column.querySelector("[title]")?.getAttribute("title"),
      dot: column.querySelector("[data-child-dot]"),
      chipLabel: chip.getAttribute("aria-label"),
      chipBlue: chip.querySelector('[class*="--timeline-accent"]') !== null,
      bold: within(row).getByTitle("Parent").className.includes("font-semibold"),
    };
  }

  for (const tree of TREES) {
    for (const expanded of [false, true]) {
      it(`${tree.name}, ${expanded ? "expanded" : "collapsed"}`, async () => {
        render(tree.threads, { prefs: expanded ? { expandedChildren: ["p"] } : {} });
        const shown = expanded ? tree.expanded : tree.collapsed;
        const seen = await parentRow();
        expect(seen.glyph).toBe(shown.state);
        expect(seen.label).toBe(`Open Parent — ${shown.state}; Claude Code`);
        expect(seen.dot !== null).toBe(shown.dot);
        if (seen.dot !== null) {
          expect(seen.dot.className).toContain("bg-muted-foreground");
          expect(seen.dot.className).toContain("ring-sidebar");
        }
        const noun = tree.chip.count === 1 ? "child thread" : "child threads";
        const unread = tree.chip.unread > 0 ? `, ${tree.chip.unread} unread in the tree` : "";
        expect(seen.chipLabel).toBe(`${expanded ? "Collapse" : "Show"} ${tree.chip.count} ${noun} of Parent${unread}`);
        expect(seen.chipBlue).toBe(tree.chip.unread > 0);
        expect(seen.bold).toBe(tree.bold);
      });
    }
  }

  it("draws a working state taken from the tree as the spinner, still under reduced motion", async () => {
    render([parent(), child("c", working)]);
    const link = await screen.findByRole("link", { name: /^Open Parent — Working, in child threads/ });
    const spinner = (link.nextElementSibling as HTMLElement).querySelector('[class*="animate-spin"]');
    expect(spinner?.className).toContain("motion-reduce:animate-none");
  });

  describe("with a plugin row status", () => {
    const extra = { sidebarRowStatuses: { p: { icon: "Timer", label: "Cache warm", tone: "neutral" } } };

    it("never replaces waits on you from the tree, which keeps its grey child dot", async () => {
      render([parent(), child("c", { hasPendingInteraction: true })], { extra });
      const link = await screen.findByRole("link", { name: /^Open Parent — / });
      expect(link.getAttribute("aria-label")).toBe("Open Parent — Needs your input, in child threads; idle; Claude Code");
      expect((link.nextElementSibling as HTMLElement).querySelector("[data-child-dot]")).not.toBeNull();
      expect(screen.queryByLabelText("Cache warm")).toBeNull();
    });

    it("replaces an unread state from the tree with no child dot, and the chip still shows the unread child", async () => {
      render([parent(), child("c", finishedUnread)], { extra });
      const link = await screen.findByRole("link", { name: /^Open Parent — / });
      expect(link.getAttribute("aria-label")).toBe("Open Parent — Cache warm; Claude Code");
      expect((link.nextElementSibling as HTMLElement).querySelector("[data-child-dot]")).toBeNull();
      expect(within(link.parentElement!).getByRole("button", { name: "Show 1 child thread of Parent, 1 unread in the tree" })).toBeTruthy();
    });
  });
});
