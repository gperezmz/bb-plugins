// @vitest-environment jsdom
// A row's menus, which are bb's own with Thread Glance's items added, and the
// list's hover card and drag, driven as a person does: rows keep their DOM
// nodes through what changes around them.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarSection, PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { Preferences } from "@/shared/preferences";
import { coreThreadActions, createFakeServer, finishedUnread, makeThread, PROJECTS, T0 } from "../testing/fixtures";

// The SDK's fake drag-to-split hook records nothing; this one notes the thread each press is handed to.
const splitPresses: string[] = [];

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_useSidebarThreadSplit(threadId: string) {
      const split = actual.experimental_useSidebarThreadSplit(threadId);
      return {
        ...split,
        splitProps: {
          ...split.splitProps,
          onPointerDown(event: never) {
            splitPresses.push(threadId);
            split.splitProps.onPointerDown?.(event);
          },
        },
      };
    },
  };
});

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
  it("puts each thread row in bb's own context menu for its thread, and marks no row, wrapper or header disabled or draggable", async () => {
    render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta", parentThreadId: "a" })], {
      prefs: { expandedChildren: ["a"] },
    });
    await link("Beta");
    for (const element of document.querySelectorAll("[data-sidebar-thread-id], [data-sidebar-rename-row], [data-sidebar='group-label']")) {
      expect(element.getAttribute("aria-disabled"), element.outerHTML.slice(0, 80)).toBeNull();
      expect(element.getAttribute("aria-roledescription")).toBeNull();
      expect(element.getAttribute("role")).toBeNull();
    }
    const menus = [...document.querySelectorAll("[data-testid='bb-thread-actions-context-menu']")].map((menu) => menu.getAttribute("data-thread-id"));
    expect(menus).toEqual(["a", "b"]);
  });

  it("marks nothing disabled or draggable on a phone either", async () => {
    render([makeThread({ id: "a", title: "Alpha" })], { props: { isCompactViewport: true } });
    await link("Alpha");
    expect(document.querySelectorAll("[aria-disabled], [aria-roledescription]")).toHaveLength(0);
  });
});

describe("the row menus", () => {
  const BB_ITEMS = ["Open in split", "Copy thread link", "Mark unread", "Pin", "Rename", "Archive", "Delete"];
  const openMenu = async (title: string) => {
    fireEvent.click(within(await rowOf(title)).getByRole("button", { name: "Thread actions" }));
    return screen.findByRole("menu");
  };
  const closeMenu = () => fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy thread link" }));

  it("lists bb's own items, then Details, Copy thread ID and Move…, from the \u2026 button and from a right-click", async () => {
    render([makeThread({ id: "a", title: "Alpha" })], { extra: { threadActions: coreThreadActions() } });
    await openMenu("Alpha");
    expect(menuNames()).toEqual([...BB_ITEMS, "Details", "Copy thread ID", "Move…"]);
    closeMenu();
    fireEvent.contextMenu(await rowOf("Alpha"), { clientX: 20, clientY: 20, button: 2 });
    await screen.findByRole("menu");
    expect(menuNames()).toEqual([...BB_ITEMS, "Details", "Copy thread ID", "Move…"]);
  });

  it("offers Mark tree read on a root with an unread thread below it, not on the thread itself, and leaves Move… out on an archived thread", async () => {
    render(
      [
        makeThread({ id: "p", title: "Parent" }),
        makeThread({ id: "c", title: "Child", parentThreadId: "p", ...finishedUnread }),
        makeThread({ id: "s", title: "Shelved", archivedAt: T0, isArchived: true }),
      ],
      { prefs: { expandedChildren: ["p"], showArchived: true } },
    );
    await openMenu("Parent");
    expect(menuNames()).toEqual(["Details", "Copy thread ID", "Mark tree read", "Move…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openMenu("Child");
    expect(menuNames()).toEqual(["Details", "Copy thread ID", "Move…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openMenu("Shelved");
    expect(menuNames()).toEqual(["Details", "Copy thread ID"]);
  });

  it("hands bb the thread as bb's actions read it", async () => {
    const seen: unknown[] = [];
    render([makeThread({ id: "a", title: "Alpha", pinnedAt: T0, isPinned: true, sectionId: "sec_1", environment: { id: "env_1", path: "/w" }, ...finishedUnread })], {
      extra: { threadActions: (thread: unknown) => (seen.push(thread), []) },
    });
    await openMenu("Alpha");
    expect(seen.at(-1)).toMatchObject({ id: "a", pinnedAt: T0, sectionId: "sec_1", archivedAt: null, parentThreadId: null, environment: { id: "env_1", path: "/w" } });
  });

  it("starts the rename editor with focus in it for bb's Rename, and closes the context menu while it edits", async () => {
    render([makeThread({ id: "a", title: "Alpha" })], { extra: { threadActions: coreThreadActions() } });
    await openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const editor = await screen.findByRole("textbox", { name: "Thread name" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(document.querySelector("[data-testid='bb-thread-actions-context-menu']")?.getAttribute("data-disabled")).toBe("true");
  });

  it("keeps the rename editor when the menu that started it focuses itself while it animates closed", async () => {
    render([makeThread({ id: "a", title: "Alpha" })], { extra: { threadActions: coreThreadActions() } });
    await openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const editor = await screen.findByRole("textbox", { name: "Thread name" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    // bb animates its menus out; Radix focuses one as the pointer leaves its items meanwhile.
    const closing = document.createElement("div");
    closing.setAttribute("role", "menu");
    closing.setAttribute("data-state", "closed");
    closing.tabIndex = -1;
    document.body.append(closing);
    act(() => closing.focus());
    closing.remove();
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect(editor.isConnected).toBe(true);
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

  it.each([
    ["the context-menu key", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("opens bb's context menu with %s on a focused row", async (_name, keys) => {
    render([makeThread({ id: "k", title: "Keyed" })], { extra: { threadActions: coreThreadActions() } });
    const anchor = await link("Keyed");
    act(() => anchor.focus());
    fireEvent.keyDown(anchor, keys);
    await screen.findByRole("menu");
    expect(menuNames()).toEqual([...BB_ITEMS, "Details", "Copy thread ID", "Move…"]);
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
    splitPresses.length = 0;
    render([makeThread({ id: "a", title: "Alpha" }), makeThread({ id: "b", title: "Beta" })]);
    const alpha = await rowOf("Alpha");
    const beta = await rowOf("Beta");
    fireEvent.pointerEnter(alpha, { pointerType: "mouse" });
    // The list scrolled Beta under the still pointer: no enter reaches it.
    fireEvent.pointerDown(beta, { pointerType: "mouse", button: 0 });
    expect(splitPresses).toEqual(["b"]);
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
