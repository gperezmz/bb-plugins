// @vitest-environment jsdom
// The list's one menu, context menu, hover card and drag, driven as a person
// does: rows are plain elements, every row's overlay is the list's, and rows
// keep their DOM nodes through what changes around them.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarSection, PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { Preferences } from "@/shared/preferences";
import { rowMenuItems } from "../model/menu";
import { createFakeServer, finishedUnread, makeThread, PROJECTS, T0 } from "../testing/fixtures";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("../../../app"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

const props: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate() {},
  searchQuery: "",
};

function render(
  threads: PluginSidebarThread[],
  options: {
    prefs?: Partial<Preferences>;
    props?: Partial<PluginThreadListProps>;
    sections?: PluginSidebarSection[];
    extra?: object;
  } = {},
) {
  return renderSlot(app.threadLists[0]!, { ...props, ...options.props }, {
    // The fixtures' threads are months old by the real clock: nothing settles unless a test asks.
    rpc: createFakeServer({ preferences: { settleAfter: "never", ...options.prefs } }).handlers as never,
    sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: options.sections ?? [] },
    providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
    sdk: {
      threads: {
        defaultExecutionOptions: async () => null,
        update: async () => ({}),
        markRead: async ({ threadId }: { threadId: string }) => ({ id: threadId }),
      } as never,
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

const link = (title: string) => screen.findByRole("link", { name: new RegExp(`Open ${title}\\b`) });
const rowOf = async (title: string) => (await link(title)).parentElement!;
const menuNames = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);

describe("rows are plain elements", () => {
  it("mounts no menu, context menu or hover card per row, and marks no row, wrapper or header disabled or draggable", async () => {
    render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta", parentThreadId: "a" })], {
      prefs: { expandedChildren: ["a"] },
    });
    await link("Beta");
    for (const element of document.querySelectorAll("[data-sidebar-thread-id], [data-sidebar-rename-row], [data-sidebar='group-label']")) {
      expect(element.getAttribute("aria-disabled"), element.outerHTML.slice(0, 80)).toBeNull();
      expect(element.getAttribute("aria-roledescription")).toBeNull();
      expect(element.getAttribute("role")).toBeNull();
    }
    // One trigger for the list's context menu; none per row.
    expect(document.querySelectorAll("[data-sidebar-context-menu-trigger]")).toHaveLength(1);
  });

  it("marks nothing disabled or draggable on a phone either", async () => {
    render([makeThread({ id: "a", title: "Alpha" })], { props: { isCompactViewport: true } });
    await link("Alpha");
    expect(document.querySelectorAll("[aria-disabled], [aria-roledescription]")).toHaveLength(0);
  });
});

describe("the row menu", () => {
  const sections: PluginSidebarSection[] = [{ id: "sec_1", name: "Later" } as PluginSidebarSection];
  const holder = makeThread({ id: "h", title: "Holder" });
  const kinds = [
    { name: "a root", thread: makeThread({ id: "r", title: "Root" }), others: [], isRoot: true },
    { name: "an unread root", thread: makeThread({ id: "r", title: "Root", ...finishedUnread }), others: [], isRoot: true },
    { name: "a pinned root", thread: makeThread({ id: "r", title: "Root", pinnedAt: T0, isPinned: true }), others: [], isRoot: true },
    {
      name: "a hidden child waiting on you",
      thread: makeThread({ id: "r", title: "Root", parentThreadId: "h", isHidden: true, hasPendingInteraction: true }),
      others: [holder],
      isRoot: false,
    },
  ];

  it.each(kinds.flatMap((kind) => (["project", "chronological", "machine"] as const).flatMap((mode) => [false, true].map((compact) => ({ ...kind, mode, compact })))))(
    "offers 0.7.0's items for $name grouped by $mode, phone $compact",
    async ({ thread, others, isRoot, mode, compact }) => {
      render([thread, ...others, makeThread({ id: "o", title: "Other" })], { prefs: { organizationMode: mode }, props: { isCompactViewport: compact }, sections });
      const row = await rowOf("Root");
      const trigger = within(row).getByRole("button", { name: "Thread actions" });
      if (compact) {
        fireEvent.pointerDown(trigger, { button: 0, pointerType: "touch" });
        fireEvent.click(trigger);
      } else fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
      await screen.findByRole("menuitem", { name: "Details" });
      const names = screen.getAllByRole("menuitem").map((item) => item.textContent);
      const expected = rowMenuItems({
        thread,
        unread: thread.isUnread || thread.latestAttentionAt > (thread.lastReadAt ?? 0),
        splitAvailable: true,
        isRoot,
        hasSections: true,
      }).map((item) => item.label);
      expect(names).toEqual(expected);
    },
  );

  it("offers 0.7.0's items for a child row and for an archived one", async () => {
    render(
      [
        makeThread({ id: "p", title: "Parent" }),
        makeThread({ id: "c", title: "Child", parentThreadId: "p" }),
      ],
      { prefs: { expandedChildren: ["p"] } },
    );
    const child = await rowOf("Child");
    fireEvent.pointerDown(within(child).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
    await screen.findByRole("menuitem", { name: "Details" });
    expect(menuNames()).toEqual(["Details", "Open in split", "Copy thread link", "Copy thread ID", "Mark unread", "Pin", "Move…", "Rename", "Archive", "Delete"]);
  });

  it("returns focus to the \"…\" button when closed with Escape, and anchors to it", async () => {
    render([makeThread({ id: "a", title: "Alpha" })]);
    const row = await rowOf("Alpha");
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    act(() => trigger.focus());
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("starts the rename editor with focus in it after Rename closes the menu", async () => {
    render([makeThread({ id: "a", title: "Alpha" })]);
    const row = await rowOf("Alpha");
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const rename = await screen.findByRole("menuitem", { name: "Rename" });
    fireEvent.keyDown(rename, { key: "Enter" });
    fireEvent.click(rename);
    const editor = await screen.findByRole("textbox", { name: "Thread name" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it("opens a group header's menu and starts its rename with focus in the editor", async () => {
    render([makeThread({ id: "a", title: "Alpha", sectionId: "sec_1" })], {
      prefs: { organizationMode: "chronological" },
      sections: [{ id: "sec_1", name: "Later" } as PluginSidebarSection],
    });
    await link("Alpha");
    const trigger = screen.getByRole("button", { name: "Later actions" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const rename = await screen.findByRole("menuitem", { name: "Rename" });
    fireEvent.pointerDown(rename, { button: 0, pointerType: "mouse" });
    fireEvent.click(rename);
    const editor = await screen.findByRole("textbox", { name: "Section name" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it("opens the row's menu as a drawer on a long press on a phone, choosing nothing on release, and not after a 10 px move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render([makeThread({ id: "a", title: "Alpha" })], { props: { isCompactViewport: true } });
    const row = await rowOf("Alpha");
    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 10, clientY: 22 }] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.queryByRole("menuitem", { name: "Details" })).toBeNull();
    fireEvent.touchEnd(row);
    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    const details = await screen.findByRole("menuitem", { name: "Details" });
    fireEvent.touchEnd(row);
    fireEvent.click(details);
    expect(screen.queryByRole("dialog", { name: /Alpha/ })).toBeNull();
  });
});

describe("the context menu", () => {
  it.each([
    ["the context-menu key", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("opens with %s on a focused row, with a right-click's items, and returns focus to the row", async (_name, keys) => {
    render([makeThread({ id: "k", title: "Keyed", ...finishedUnread })]);
    const anchor = await link("Keyed");
    fireEvent.contextMenu(anchor.parentElement!, { clientX: 20, clientY: 20, button: 2 });
    await screen.findByRole("menuitem", { name: "Mark read" });
    const byPointer = menuNames();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    act(() => anchor.focus());
    fireEvent.keyDown(anchor, keys);
    await screen.findByRole("menuitem", { name: "Mark read" });
    expect(menuNames()).toEqual(byPointer);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(anchor));
  });
});

describe("the hover card", () => {
  const threads = [
    makeThread({ id: "a", title: "Alpha row", updatedAt: T0 + 2, latestAttentionAt: T0 + 2 }),
    makeThread({ id: "b", title: "Beta row", updatedAt: T0 + 1, latestAttentionAt: T0 + 1 }),
  ];
  const card = () => screen.queryByText("Harness");
  const wait = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  const hover = (row: HTMLElement) => {
    fireEvent.pointerEnter(row, { pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { pointerType: "mouse", clientX: 14, clientY: 10 });
  };

  it("never opens for the focused thread's row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(threads, { props: { activeThreadId: "a" } });
    hover(await rowOf("Alpha row"));
    await wait(600);
    expect(card()).toBeNull();
  });

  it("never opens while a row is being renamed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(threads);
    fireEvent.doubleClick(await link("Alpha row"));
    await screen.findByRole("textbox", { name: "Thread name" });
    hover(await rowOf("Beta row"));
    await wait(600);
    expect(card()).toBeNull();
  });

  it("stays shut after a press until the pointer leaves, and shows the thread's details once it opens", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(threads);
    const beta = await rowOf("Beta row");
    hover(beta);
    fireEvent.pointerDown(beta, { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(beta, { pointerType: "mouse", clientX: 18, clientY: 10 });
    await wait(600);
    expect(card()).toBeNull();
    fireEvent.pointerLeave(beta, { pointerType: "mouse" });
    hover(beta);
    await wait(600);
    expect(card()).not.toBeNull();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
  });
});

describe("drag-to-split through one probe", () => {
  it("hands a press to bb's drag-to-split for the pressed row, even with no pointer entering it first", async () => {
    const slot = render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta" })]);
    const alpha = await rowOf("Alpha");
    const beta = await rowOf("Beta");
    fireEvent.pointerEnter(alpha, { pointerType: "mouse" });
    // The list scrolled Beta under the still pointer: no enter reaches it.
    fireEvent.pointerDown(beta, { pointerType: "mouse", button: 0 });
    expect(slot.inspection.sidebarActionCalls.filter((call) => call.method === "open").map((call) => call.threadId)).toEqual(["b"]);
  });
});

describe("draft and row status", () => {
  it("draws a draft glyph from bb's list-wide draft ids, and another plugin's row status over it", async () => {
    render([makeThread({ id: "d", title: "Drafted" }), makeThread({ id: "s", title: "Statused" })], {
      extra: {
        sidebarDraftThreadIds: ["d", "s"],
        sidebarRowStatuses: { s: { icon: "Fire", label: "Keeping warm", tone: "running" } },
      },
    });
    expect((await link("Drafted")).getAttribute("aria-label")).toMatch(/draft/i);
    expect((await link("Statused")).getAttribute("aria-label")).toMatch(/Keeping warm/);
  });
});

describe("the one drag", () => {
  const press = async (row: HTMLElement) => {
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 30 });
    await act(async () => {});
  };

  it("starts from a row on a desktop, including one first drawn as a phone", async () => {
    const slot = render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta" })], { props: { isCompactViewport: true } });
    const phone = await rowOf("Alpha");
    await press(phone);
    expect(phone.className).not.toMatch(/opacity-50/);
    fireEvent.mouseUp(document);
    const List = app.threadLists[0]!.component;
    slot.lifecycle.rerender(<List {...props} isCompactViewport={false} />);
    const desktop = await rowOf("Alpha");
    await press(desktop);
    await waitFor(() => expect(desktop.className).toMatch(/opacity-50/));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseUp(document);
  });
});
