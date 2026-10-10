// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/signals";
import manifest from "./package.json";
import {
  coreThreadActions,
  createFakeServer,
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
  scheduled: Record<string, number> = {},
) {
  // The fixtures' threads are months old by the real clock: nothing settles unless a test asks.
  return createFakeServer({ preferences: { settleAfter: "never", ...prefs }, stamps, notes: notes as never, scheduled }).handlers;
}

function render(
  threads: ReturnType<typeof makeThread>[],
  options: {
    prefs?: Partial<Preferences>;
    props?: Partial<PluginThreadListProps>;
    extra?: object;
    /** bb's harnesses, as `providers.list()` answers; by default Claude Code then Codex. */
    providerList?: () => Promise<unknown>;
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
      threads: {
        defaultExecutionOptions: async () => null,
        update: async () => ({}),
        pin: async () => ({}),
        unpin: async () => ({}),
        markUnread: async () => ({}),
        markRead: async ({ threadId }: { threadId: string }) => ({ id: threadId }),
      } as never,
      projects: {
        update: async () => ({}),
        get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
        branches: async () => ({ defaultBranch: "main" }),
      } as never,
      // No default harness chosen: bb starts threads on the first available one.
      providers: {
        models: async () => ({ models: [] }),
        list:
          options.providerList ??
          (async () => [
            { id: "claude-code", available: true },
            { id: "codex", available: true },
          ]),
      } as never,
      system: {
        config: async () => ({
          primaryHostId: "host_1",
          generalSettings: { defaultProviderId: null },
          serverAccess: { defaultProviderId: "connect" },
        }),
      } as never,
    },
    ...options.extra,
  });
}

/** The threads bb was asked to mark read, sorted. */
function markedRead(slot: ReturnType<typeof render>): string[] {
  return slot.inspection.sdkCalls
    .filter((call) => call.method === "threads.markRead")
    .map((call) => (call.args[0] as { threadId: string }).threadId)
    .sort();
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
  });

  it("opens and closes a tree from its chip", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      ...[1, 2].map((n) => makeThread({ id: `c${n}`, title: `Child ${n}`, parentThreadId: "m", createdAt: T0 + n, ...working })),
    ]);
    const chip = await screen.findByRole("button", { name: "Show 2 child threads of Parent, working below" });
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
      ["Branch line" + "A thread off its project's default branch names the branch under its title", "false"],
      ["Needs attention counts every child" + "Every unread or failed child thread; otherwise only those blocked on you.", "false"],
    ]);
    expect(within(panel).getByRole("button", { name: /Sort order: Newest first/ }).textContent).toBe("↓");
    // Nothing else: the radios, checkboxes and the arrow are every control.
    expect(within(panel).getAllByRole("radio")).toHaveLength(15);
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    expect(panel.querySelectorAll("button")).toHaveLength(15 + 3 + 1);
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
    // The write waits out its debounce on this clock, so the echo lands before it goes out.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(within(panel).getByRole("button", { name: /Sort order: Newest first/ }));
      expect(order()).toEqual(["Open A old", "Open A new"]);
      await list.emitRealtime(CHANNELS.preferences, { key: "sortDirection", value: "default" });
      expect(order()).toEqual(["Open A old", "Open A new"]);
      expect(list.inspection.rpcCalls.some((call) => call.method === "setPreference")).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(list.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "setPreference", input: expect.objectContaining({ key: "sortDirection" }) }),
      );
      expect(order()).toEqual(["Open A old", "Open A new"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies Density and Branch line picked in the panel at once, each leaving the other, and keeps both for the next list", async () => {
    const threads = [makeThread({ id: "a", title: "Busy", ...working, environment: { branchName: "feature" } })];
    render(threads);
    const row = () => screen.getAllByRole("link", { name: /Open Busy/ })[0]!.parentElement!;
    await screen.findByRole("link", { name: /Open Busy/ });
    const panel = await openSettings();
    const branchLine = () => within(panel).getByRole("checkbox", { name: /Branch line/ });
    const comfortable = () => within(within(panel).getByRole("radiogroup", { name: "Density" })).getByRole("radio", { name: "Comfortable" });
    expect(row().textContent).not.toContain("feature");
    // Density alone is spacing: the row stays one line.
    fireEvent.click(comfortable());
    await waitFor(() => expect(row().className).toContain("h-8"));
    expect(row().textContent).not.toContain("feature");
    expect(branchLine().getAttribute("aria-checked")).toBe("false");
    // Branch line alone adds the branch, in either density.
    fireEvent.click(branchLine());
    await waitFor(() => expect(row().textContent).toContain("feature"));
    expect(comfortable().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(within(panel).getByRole("radiogroup", { name: "Density" })).getByRole("radio", { name: "Compact" }));
    await waitFor(() => expect(row().className).toContain("h-11"));
    expect(row().textContent).toContain("feature");
    expect(branchLine().getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(localStorage.getItem("bb.thread-glance.client.v1")!)).toEqual({ density: "compact", branchLine: true });
    cleanup();
    render(threads);
    await screen.findByRole("link", { name: /Open Busy/ });
    expect(row().textContent).toContain("feature");
    expect(row().className).toContain("h-11");
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

  it("draws a muted chip with a count and chevron only while its children are quiet, and nothing of theirs on the parent's glyph", async () => {
    render([
      makeThread({ id: "m", title: "Parent" }),
      makeThread({ id: "c", title: "Quiet child", parentThreadId: "m", createdAt: T0 + 1, providerId: "codex" }),
      makeThread({ id: "u", title: "Fresh", ...finishedUnread }),
    ]);
    const chip = await screen.findByRole("button", { name: "Show 1 child thread of Parent" });
    expect(chip.textContent).toBe("1");
    expect(chip.className).not.toMatch(/text-attention|text-destructive|--timeline-accent/);
    expect(chip.className).not.toMatch(/(^|\s)border(\s|-)/);
    expect(chip.className).not.toMatch(/(^|\s)bg-/);
    const parent = await screen.findByRole("link", { name: "Open Parent — Idle; Claude Code" });
    expect((parent.nextElementSibling as HTMLElement).children).toHaveLength(1);
    const dot = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!.querySelector('span[class*="rounded-full"]');
    expect(dot?.className).toContain("--timeline-accent");
  });

  it("puts the pull request badge after the branch with Branch line on, on the title line with it off, and names another machine beside the age", async () => {
    const threads = [
      makeThread({ id: "b", title: "Topic", environment: { branchName: "fix/login" }, host: { id: "host_2", name: "work" } }),
    ];
    const extra = { sidebarPullRequests: { b: { number: 7, title: "Fix", url: "u", state: "open", attention: "none" } } };
    render(threads, { extra });
    const anchor = await screen.findByRole("link", { name: /Open Topic/ });
    const row = anchor.parentElement!;
    const badge = await within(row).findByLabelText(/Pull request #7/);
    // Branch line off: one line, the badge beside the title, and no branch.
    expect(row.textContent).not.toContain("fix/login");
    expect(within(row).getByLabelText("On work").textContent).toBe("work");
    expect(within(row).getByLabelText(/ago|now/)).toBeTruthy();
    expect(badge.closest("span.flex-col")).toBeNull();
    cleanup();
    localStorage.setItem("bb.thread-glance.client.v1", JSON.stringify({ density: "compact", branchLine: true }));
    render(threads, { extra });
    const comfortable = (await screen.findByRole("link", { name: /Open Topic/ })).parentElement!;
    await waitFor(() => expect(comfortable.textContent).toContain("fix/login"));
    const line = within(comfortable).getByText("fix/login").closest("span.text-xs")!;
    expect(within(line as HTMLElement).getByLabelText(/Pull request #7/)).toBeTruthy();
    expect(within(comfortable).getAllByLabelText(/Pull request #7/)).toHaveLength(1);
    expect(within(comfortable).getByLabelText("On work")).toBeTruthy();
  });

  it("keeps the pull request badge on the title line of a row whose second line is a note, with Branch line on", async () => {
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

  it("runs bb's own Mark read and Archive from a row's hover buttons, Mark read only on a thread bb has unread", async () => {
    const ran: string[] = [];
    render([makeThread({ id: "u", title: "Fresh", isUnread: true, ...finishedUnread }), makeThread({ id: "q", title: "Calm" })], {
      extra: { threadActions: coreThreadActions(ran) },
    });
    const fresh = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!;
    const calm = (await screen.findByRole("link", { name: /Open Calm/ })).parentElement!;
    expect(within(calm).queryByRole("button", { name: "Mark read" })).toBeNull();
    const button = within(fresh).getByRole("button", { name: "Mark read" });
    expect(button.nextElementSibling?.getAttribute("aria-label")).toBe("Archive thread");
    fireEvent.click(button);
    fireEvent.click(within(calm).getByRole("button", { name: "Archive thread" }));
    await waitFor(() => expect(ran).toEqual(["read u", "archive q"]));
  });

  it.each([
    ["a read", false, ["c", "d"]],
    ["an unread", true, ["c", "d", "r"]],
  ] as const)("marks %s root's whole tree read from its hover button while a thread below it is unread", async (_, rootUnread, marked) => {
    const ran: string[] = [];
    const slot = render([
      makeThread({ id: "r", title: "Root", ...(rootUnread ? { isUnread: true, ...finishedUnread } : {}) }),
      makeThread({ id: "c", title: "Child", parentThreadId: "r", createdAt: T0 + 1, isUnread: true, ...finishedUnread }),
      makeThread({ id: "d", title: "Done child", parentThreadId: "r", createdAt: T0 + 2 }),
    ], { stamps: { finishedAt: { d: T0 + 50 } }, extra: { threadActions: coreThreadActions(ran) } });
    const row = (await screen.findByRole("link", { name: /Open Root/ })).parentElement!;
    expect(within(row).queryByRole("button", { name: "Mark read" })).toBeNull();
    const button = within(row).getByRole("button", { name: "Mark tree read" });
    expect(button.getAttribute("title")).toBe("Mark tree read");
    expect(button.nextElementSibling?.getAttribute("aria-label")).toBe("Archive thread");
    fireEvent.click(button);
    await waitFor(() => expect(markedRead(slot)).toEqual(marked));
    expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "markSeen", input: { threadIds: ["d"] } }));
    // bb's Mark read is not run: the tree's reads went to bb one thread at a time.
    expect(ran).toEqual([]);
  });

  it("runs bb's Mark read from the hover button of an unread child row and of an unread root with nothing unread below it", async () => {
    const ran: string[] = [];
    render([
      makeThread({ id: "r", title: "Root", isUnread: true, ...finishedUnread }),
      makeThread({ id: "c", title: "Child", parentThreadId: "r", createdAt: T0 + 1 }),
      makeThread({ id: "p", title: "Parent" }),
      makeThread({ id: "k", title: "Kid", parentThreadId: "p", createdAt: T0 + 1, isUnread: true, ...finishedUnread }),
    ], { extra: { threadActions: coreThreadActions(ran) }, prefs: { expandedChildren: ["p"] } });
    const root = (await screen.findByRole("link", { name: /Open Root/ })).parentElement!;
    expect(within(root).queryByRole("button", { name: "Mark tree read" })).toBeNull();
    fireEvent.click(within(root).getByRole("button", { name: "Mark read" }));
    const kid = (await screen.findByRole("link", { name: /Open Kid/ })).parentElement!;
    expect(within(kid).queryByRole("button", { name: "Mark tree read" })).toBeNull();
    fireEvent.click(within(kid).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(ran).toEqual(["read r", "read k"]));
  });

  it("marks a whole tree read with Mark tree read in a root's menu", async () => {
    const slot = render([
      makeThread({ id: "r", title: "Root" }),
      makeThread({ id: "c", title: "Child", parentThreadId: "r", createdAt: T0 + 1, ...finishedUnread }),
      makeThread({ id: "d", title: "Done child", parentThreadId: "r", createdAt: T0 + 2 }),
    ], { stamps: { finishedAt: { d: T0 + 50 } } });
    const row = (await screen.findByRole("link", { name: /Open Root/ })).parentElement!;
    fireEvent.click(within(row).getByRole("button", { name: "Thread actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark tree read" }));
    await waitFor(() => expect(markedRead(slot)).toEqual(["c", "d"]));
    expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "markSeen", input: { threadIds: ["d"] } }));
  });

  it("draws no Mark read hover action on a phone", async () => {
    render([makeThread({ id: "u", title: "Fresh", ...finishedUnread })], { props: { isCompactViewport: true } });
    const row = (await screen.findByRole("link", { name: /Open Fresh/ })).parentElement!;
    expect(within(row).queryByRole("button", { name: "Mark read" })).toBeNull();
  });

  it("the header + opens a new thread in its project", async () => {
    const slot = render([makeThread({ id: "t" })]);
    fireEvent.click(await screen.findByRole("button", { name: "New thread in Alpha" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { projectId: "proj_a", focusPrompt: true } });
  });

  it("the Pinned header + starts a pinned thread", async () => {
    const slot = render([makeThread({ id: "t", pinnedAt: T0, isPinned: true })]);
    fireEvent.click(await screen.findByRole("button", { name: "New thread in Pinned" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { placement: { sectionId: null, pinned: true }, focusPrompt: true } });
  });

  it("a machine header + starts a thread on that machine", async () => {
    const slot = render([makeThread({ id: "t" })], { prefs: { organizationMode: "machine" } });
    fireEvent.click(await screen.findByRole("button", { name: "New thread in Laptop" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { hostId: "host_1", focusPrompt: true } });
  });

  it("a project header's menu offers Rename and Remove project, but no Project settings, which bb gives a plugin no route to", async () => {
    render([makeThread({ id: "t" })]);
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Alpha actions" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Remove project" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /settings/i })).toBeNull();
  });

  it("renames a project in place from its header, in a box named for a project", async () => {
    const slot = render([makeThread({ id: "t" })]);
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Alpha actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const editor = await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.change(editor, { target: { value: "Alpha two" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toContainEqual(expect.objectContaining({ method: "projects.update", args: [{ projectId: "proj_a", name: "Alpha two" }] })),
    );
  });

  it("draws headers and rows at the height of the viewport bb says it is", async () => {
    const heights = async (isCompactViewport: boolean) => {
      render([makeThread({ id: "t" })], { props: { isCompactViewport } });
      const header = (await screen.findByRole("button", { name: "Alpha actions" })).closest("[data-sidebar='group-label']")!;
      const row = (await screen.findByRole("link", { name: /Open Thread t/ })).parentElement!;
      const out = [header.className.match(/\bh-\d+\b/)![0], row.className.match(/\bh-\d+\b/)![0]];
      cleanup();
      return out;
    };
    expect(await heights(false)).toEqual(["h-7", "h-7"]);
    expect(await heights(true)).toEqual(["h-9", "h-9"]);
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

  it("draws no root's harness while bb's default harness is unknown, whatever reaches machines", async () => {
    render([makeThread({ id: "x", title: "Codex root", providerId: "codex" })], {
      providerList: async () => Promise.reject(new Error("offline")),
    });
    const row = (await screen.findByRole("link", { name: /Open Codex root/ })).parentElement!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(row).queryByRole("img", { name: "Codex" })).toBeNull();
  });

  it("draws a two-letter mark for providers without a logo", async () => {
    render([makeThread({ id: "t", providerId: "codex" })]);
    const marks = await screen.findAllByRole("img", { name: "Codex" });
    expect(marks[0]!.textContent).toBe("CO");
  });

  it("folds settled trees behind a muted Settled (N) divider, and saves its opening on the server", async () => {
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
      const fold = await screen.findByRole("button", { name: "Show 1 settled thread tree" });
      expect(fold.textContent).toBe("Settled (1)");
      expect(fold.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByRole("link", { name: /Open Live/ })).toBeTruthy();
      expect(screen.queryByRole("link", { name: /Open Old/ })).toBeNull();
      // A merged pull request settles nothing: Merged is as recent as Live.
      expect(screen.getByRole("link", { name: /Open Merged/ })).toBeTruthy();
      expect(screen.queryByText(/older/)).toBeNull();
      fireEvent.click(fold);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("button", { name: "Hide 1 settled thread tree" }).textContent).toBe("Settled");
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

  it("marks threads in hidden groups read too from the header's Mark all read", async () => {
    const few = [
      makeThread({ id: "u1", title: "U1", ...finishedUnread }),
      makeThread({ id: "u2", title: "U2", projectId: "proj_b", ...finishedUnread }),
      makeThread({ id: "c", title: "C", parentThreadId: "u1", createdAt: T0 + 1, ...finishedUnread }),
    ];
    const slot = render(few, { prefs: { hiddenGroups: ["project:proj_b"] } });
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(markedRead(slot)).toEqual(["c", "u1", "u2"]),
    );
  });

  it("draws Mark all read in the header only while something in the list is unread, live as that changes", async () => {
    render([]);
    await screen.findByText("No threads yet.");
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    cleanup();
    const threads = [makeThread({ id: "q", title: "Quiet" }), makeThread({ id: "u", title: "Unread", ...finishedUnread })];
    const slot = render(threads);
    expect(await screen.findByRole("button", { name: "Mark all read" })).toBeTruthy();
    // Opening the one unread thread leaves nothing unread; leaving it, bb has not marked it read yet here.
    const List = app.threadLists[0]!.component;
    slot.lifecycle.rerender(<List {...props} activeThreadId="u" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull());
    slot.lifecycle.rerender(<List {...props} activeThreadId={null} />);
    expect(await screen.findByRole("button", { name: "Mark all read" })).toBeTruthy();
  });

  it("offers Mark all read in a group's menu only while something in that group is unread", async () => {
    render([makeThread({ id: "q", title: "Quiet" }), makeThread({ id: "u", title: "Unread", projectId: "proj_b", ...finishedUnread })]);
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Alpha actions" }), { button: 0, pointerType: "mouse" });
    await screen.findByRole("menuitem", { name: "Customize list" });
    expect(screen.queryByRole("menuitem", { name: "Mark all read" })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Beta actions" }), { button: 0, pointerType: "mouse" });
    expect(await screen.findByRole("menuitem", { name: "Mark all read" })).toBeTruthy();
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

describe("thread actions", () => {
  const rowOf = async (title: string) => (await screen.findByRole("link", { name: new RegExp(`Open ${title}`) })).parentElement!;
  const openRowMenu = async (title: string) => {
    fireEvent.click(within(await rowOf(title)).getByRole("button", { name: "Thread actions" }));
    await screen.findByRole("menu");
  };

  it("runs bb's own item picked in a row's menu, for that row's thread", async () => {
    const ran: string[] = [];
    render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta" })], { extra: { threadActions: coreThreadActions(ran) } });
    for (const [title, item] of [["Alpha", "Pin"], ["Alpha", "Mark unread"], ["Beta", "Open in split"], ["Beta", "Archive"], ["Alpha", "Delete"]] as const) {
      await openRowMenu(title);
      fireEvent.click(screen.getByRole("menuitem", { name: item }));
    }
    await waitFor(() => expect(ran).toEqual(["pin a", "read a", "split b", "archive b", "delete a"]));
  });

  it("opens a split on Ctrl or Cmd+click, and a thread from its details, through bb's navigation; Details offers bb's own read item", async () => {
    const ran: string[] = [];
    const slot = render([makeThread({ id: "a", title: "Alpha" })], { extra: { threadActions: coreThreadActions(ran) } });
    fireEvent.click(await screen.findByRole("link", { name: /Open Alpha/ }), { ctrlKey: true });
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "a", options: { split: true } });
    await openRowMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark unread" }));
    await waitFor(() => expect(ran).toEqual(["read a"]));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "a" });
  });

  it("renames in its own editor for bb's Rename, saving silently through bb's threads.update", async () => {
    const slot = render([makeThread({ id: "a", title: "Alpha" })], { extra: { threadActions: coreThreadActions() } });
    await openRowMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const editor = await screen.findByRole("textbox");
    fireEvent.change(editor, { target: { value: "Renamed" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toContainEqual(expect.objectContaining({ method: "threads.update", args: [{ threadId: "a", title: "Renamed" }] })),
    );
  });

  it("copies the thread's ID with Copy thread ID", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render([makeThread({ id: "thr_a", title: "Alpha" })]);
    await openRowMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("thr_a"));
  });

  it("archives an environment's threads through bb's own environment archive", async () => {
    const worktree = { id: "env_w", name: "feature", isWorktree: true };
    const slot = render([makeThread({ id: "a", environment: worktree }), makeThread({ id: "b", environment: worktree })], {
      prefs: { environmentGrouping: true },
    });
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Environment actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(slot.inspection.experimental_environmentArchiveCalls).toEqual(["env_w"]);
    expect(slot.inspection.sdkCalls.map((call) => call.method)).not.toContain("environments.archiveThreads");
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
    fireEvent.click(within(row).getByRole("button", { name: "Thread actions" }));
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

  it("does not open for a move event that doesn't leave the entry point", () =>
    withTimers(async () => {
      render(threads);
      const beta = await rowOf("Beta row");
      enter(beta);
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
      fireEvent.click(actions);
      await wait(50);
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy thread ID" }));
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

describe("the glyph is the thread, the children chip is its children", () => {
  type Overrides = Omit<Parameters<typeof makeThread>[0], "id">;
  const parent = (overrides: Overrides = {}) => makeThread({ id: "p", title: "Parent", ...overrides });
  const child = (id: string, overrides: Overrides = {}, parentId = "p") =>
    makeThread({ id, title: `Child ${id}`, parentThreadId: parentId, createdAt: T0 + id.length, ...overrides });

  const STATES: [string, Overrides][] = [
    ["idle", {}],
    ["working", working],
    ["unread", finishedUnread],
    ["waits on you", { hasPendingInteraction: true }],
    ["failed", failedUnread],
  ];
  // What the chip shows for a child in each state: its glyph, the chip's colour and the label's words.
  const CHIP: Record<string, { icon: string; tone: string; words: string } | null> = {
    idle: null,
    working: { icon: "Loading", tone: "--timeline-accent", words: "working below" },
    unread: { icon: "dot", tone: "--timeline-accent", words: "unread below" },
    "waits on you": { icon: "CircleQuestion", tone: "text-attention", words: "waiting on you below" },
    failed: { icon: "CircleX", tone: "text-destructive", words: "failed below" },
  };

  /** What a person reads off the parent's row. */
  async function parentRow() {
    const link = await screen.findByRole("link", { name: /^Open Parent — / });
    const chip = within(link.parentElement!).queryByRole("button", { name: /child threads? of Parent/ });
    // The state glyph comes before the count; with none, the count leads.
    const lead = chip?.firstChild instanceof HTMLElement ? chip.firstChild : null;
    return {
      label: link.getAttribute("aria-label"),
      column: (link.nextElementSibling as HTMLElement).outerHTML,
      chip,
      chipIcon: lead === null ? null : (lead.getAttribute("data-icon") ?? (lead.className.includes("rounded-full") ? "dot" : null)),
    };
  }

  for (const [own, ownOverrides] of STATES) {
    for (const [kid, kidOverrides] of STATES) {
      for (const expanded of [false, true]) {
        it(`parent ${own}, child ${kid}, ${expanded ? "open" : "collapsed"}`, async () => {
          render([parent(ownOverrides)]);
          const alone = await parentRow();
          cleanup();
          render([parent(ownOverrides), child("c", kidOverrides)], { prefs: expanded ? { expandedChildren: ["p"] } : {} });
          const seen = await parentRow();
          // The Status column and the row's label are the parent's own, as with no children.
          expect(seen.column).toBe(alone.column);
          expect(seen.label).toBe(alone.label);
          const shown = CHIP[kid]!;
          const verb = expanded ? "Collapse" : "Show";
          expect(seen.chip!.getAttribute("aria-label")).toBe(`${verb} 1 child thread of Parent${shown ? `, ${shown.words}` : ""}`);
          expect(seen.chipIcon).toBe(shown?.icon ?? null);
          if (shown) expect(seen.chip!.className).toContain(shown.tone);
          else expect(seen.chip!.className).not.toMatch(/text-attention|text-destructive|--timeline-accent/);
          expect(seen.chip!.textContent).toBe("1");
        });
      }
    }
  }

  it("leaves a hidden child working off the chip", async () => {
    render([parent(), child("c"), child("hh", { ...working, isHidden: true })]);
    const seen = await parentRow();
    expect(seen.chipIcon).toBeNull();
    expect(seen.chip!.getAttribute("aria-label")).toBe("Show 1 child thread of Parent");
  });

  it("shows a hidden child waiting on you with no number when no child is visible", async () => {
    render([parent(), child("hh", { hasPendingInteraction: true, isHidden: true })]);
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("CircleQuestion");
    expect(seen.chip!.textContent).toBe("");
    expect(seen.chip!.getAttribute("aria-label")).toBe("Show hidden child threads of Parent, waiting on you below");
  });

  it("keeps a chip with no number for a hidden child's failure that needs no attention", async () => {
    render([parent(working), child("hh", { queuedWork: "failed", isHidden: true })]);
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("AlertTriangle");
    expect(seen.chip!.className).toContain("text-destructive");
    expect(seen.chip!.textContent).toBe("");
    expect(seen.chip!.getAttribute("aria-label")).toBe("Show hidden child threads of Parent, queued message failed below");
  });

  it("shows a queued message failure and an offline machine below with their own glyphs", async () => {
    render([parent(), child("c", { queuedWork: "failed" })]);
    expect((await parentRow()).chipIcon).toBe("AlertTriangle");
    cleanup();
    render([parent(), child("c", { status: "active", runtimeStatus: "waiting-for-host" })]);
    const offline = await parentRow();
    expect(offline.chipIcon).toBe("CloudOff");
    expect(offline.chip!.className).toContain("text-attention");
    expect(offline.chip!.getAttribute("aria-label")).toBe("Show 1 child thread of Parent, machine offline below");
  });

  // Every other own state, beside a working child: the glyph and row label are the parent's alone.
  const future = Date.now() + 86_400_000;
  const OTHER_STATES: [string, Overrides, object][] = [
    ["Queued message failed to send", { queuedWork: "failed" }, {}],
    ["Machine offline", { status: "active", runtimeStatus: "waiting-for-host" }, {}],
    ["Background agent running", { activity: { backgroundAgents: 1 } }, {}],
    ["Scheduled message", { queuedWork: "waiting" }, { rpc: rpc({}, {}, {}, { p: future }) }],
    ["Message waiting to send", { queuedWork: "waiting" }, {}],
    ["Unsubmitted draft", {}, { sidebarDraftThreadIds: ["p"] }],
  ];
  for (const [own, overrides, extra] of OTHER_STATES) {
    it(`parent in "${own}" draws the same glyph and label with a working child`, async () => {
      render([parent(overrides)], { extra });
      const alone = await parentRow();
      expect(alone.label).toMatch(new RegExp(`^Open Parent — ${own}[;,]`));
      cleanup();
      render([parent(overrides), child("c", working)], { extra });
      const seen = await parentRow();
      expect(seen.column).toBe(alone.column);
      expect(seen.label).toBe(alone.label);
      expect(seen.chipIcon).toBe("Loading");
    });
  }

  it("keeps a plugin row status set on the parent as the parent's own", async () => {
    const extra = { sidebarRowStatuses: { p: { icon: "Fire", label: "Keeping the cache warm", tone: "running" } } };
    render([parent()], { extra });
    const alone = await parentRow();
    cleanup();
    render([parent(), child("c", finishedUnread)], { extra });
    const seen = await parentRow();
    expect(seen.column).toBe(alone.column);
    expect(seen.label).toBe(alone.label);
    expect(seen.column).toContain('data-icon="Fire"');
    expect(seen.chipIcon).toBe("dot");
  });

  it("shows the most urgent of children in different states", async () => {
    render([parent(), child("a", finishedUnread), child("bb", working), child("ccc", failedUnread)]);
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("CircleX");
    expect(seen.chip!.className).toContain("text-destructive");
  });

  it("shows an unread child's filled dot, not the Cache Keeper status set on that child", async () => {
    const extra = { sidebarRowStatuses: { c: { icon: "Fire", label: "Keeping the cache warm", tone: "running" } } };
    render([parent(), child("c", finishedUnread)], { extra });
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("dot");
    expect(seen.chip!.querySelector('[data-icon="Fire"]')).toBeNull();
    expect(seen.label).toBe("Open Parent — Idle; Claude Code");
  });

  it("shows the plain question mark for two children waiting on you in different ways", async () => {
    const notes = { a: { pending: { kind: "approval", text: "Run it?" } }, bb: { pending: { kind: "plan", text: "Review the plan" } } };
    render([parent(), child("a", { hasPendingInteraction: true }), child("bb", { hasPendingInteraction: true })], { notes });
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("CircleQuestion");
  });

  it("does not count descendants waiting in the label when there are more of them than direct children", async () => {
    render([
      parent(),
      child("c"),
      child("g1", { hasPendingInteraction: true }, "c"),
      child("g2", { hasPendingInteraction: true }, "c"),
      child("g3", { hasPendingInteraction: true }, "c"),
    ]);
    const seen = await parentRow();
    expect(seen.chipIcon).toBe("CircleQuestion");
    expect(seen.chip!.getAttribute("aria-label")).toBe("Show 1 child thread of Parent, waiting on you below");
  });

  it("keeps the chip's spinner still under reduced motion", async () => {
    render([parent(), child("c", working)]);
    const seen = await parentRow();
    expect(seen.chip!.firstElementChild!.className).toContain("motion-reduce:animate-none");
  });
});

describe("the open thread is never unread", () => {
  // bb bumps latestAttentionAt when the thread finishes or fails and marks it
  // read a moment later: these hold that moment still.
  const cases = [
    { name: "a root that just finished", mode: "blocked" as const, state: finishedUnread, child: false },
    { name: "a root that just failed", mode: "blocked" as const, state: failedUnread, child: false },
    { name: "a child that just finished, counting every child", mode: "everything" as const, state: finishedUnread, child: true },
    { name: "a child that just failed, counting every child", mode: "everything" as const, state: failedUnread, child: true },
  ];
  const threadsFor = (c: (typeof cases)[number]) =>
    c.child
      ? [makeThread({ id: "m", title: "Parent" }), makeThread({ id: "v", title: "Viewed", parentThreadId: "m", createdAt: T0 + 1, ...c.state })]
      : [makeThread({ id: "v", title: "Viewed", ...c.state })];

  for (const c of cases) {
    it(`draws no need-you filter and no unread row for ${c.name} while it is open`, async () => {
      render(threadsFor(c), { prefs: { childAttention: c.mode }, props: { activeThreadId: "v" } });
      const row = await screen.findByRole("link", { name: /^Open Viewed —/ });
      expect(row.getAttribute("aria-label")).not.toMatch(/unread/i);
      expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
    });

    it(`counts ${c.name} once it is not open`, async () => {
      render(threadsFor(c), { prefs: { childAttention: c.mode } });
      await screen.findByRole("button", { name: "1 need you" });
    });
  }

  it("leaves a thread another split pane shows out of unread, as the focused one", async () => {
    render([makeThread({ id: "v", title: "Viewed", ...finishedUnread }), makeThread({ id: "f", title: "Focused" })], {
      props: { activeThreadId: "f" },
      extra: {
        sidebarSplitLayout: {
          panes: [
            { paneId: "p1", rect: { x: 0, y: 0, width: 0.5, height: 1 }, threadId: "f", isFocused: true },
            { paneId: "p2", rect: { x: 0.5, y: 0, width: 0.5, height: 1 }, threadId: "v", isFocused: false },
          ],
        },
      },
    });
    const row = await screen.findByRole("link", { name: /^Open Viewed —/ });
    expect(row.getAttribute("aria-label")).not.toMatch(/unread/i);
    expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
  });
});

describe("a child's failure while its parent is idle", () => {
  it("after a reload, waits 5 seconds from the parent going idle as another window recorded it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const wentIdle = Date.now() - 1_600;
      render(
        [
          makeThread({ id: "m", title: "Parent" }),
          makeThread({ id: "c", title: "Child", parentThreadId: "m", createdAt: T0 + 1, status: "error", latestAttentionAt: wentIdle - 7_000, lastReadAt: T0 }),
        ],
        { stamps: { idleAt: { m: wentIdle } } },
      );
      await screen.findByRole("link", { name: /^Open Parent —/ });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.getByRole("button", { name: "1 need you" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Enter on a row", () => {
  const link = (title: string) => screen.findByRole("link", { name: new RegExp(`Open ${title}\\b`) });

  it("leaves Enter and every other key on a row's link to the browser, and starts no drag with any", async () => {
    render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta" })]);
    const anchor = await link("Alpha");
    act(() => anchor.focus());
    for (const key of ["Enter", " ", "ArrowDown", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
    expect(anchor.parentElement!.className).not.toMatch(/opacity-50/);
  });
});
