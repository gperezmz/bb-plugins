/// <reference types="vite/client" />
// The windowed list in Chromium: what stays mounted while it scrolls, the
// sticky headers, bb's keyboard walk over rows that are not mounted, the
// hover card under a still pointer, and the one drag, driven with a real
// pointer through the DevTools protocol.
import "../testing/browser.css";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarSection, PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { makeThread, PROJECTS } from "../testing/fixtures";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../../../app"));
  // Rows are links: the test page must not follow one.
  document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
  });
});

afterEach(async () => {
  await mouse("mouseReleased", 0, 0);
  cleanup();
  localStorage.clear();
  window.scrollTo(0, 0);
});

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real mouse event at client coordinates, through the DevTools protocol. */
async function mouse(type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number) {
  await cdp().send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
}

/** Presses at `from`, moves to `to` in steps, and releases there, as a person drags. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, beforeRelease?: () => Promise<void>) {
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y);
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await mouse("mouseMoved", from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await frames();
  }
  await beforeRelease?.();
  await mouse("mouseReleased", to.x, to.y);
  await frames();
}

const props: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate() {},
  searchQuery: "",
};

const many = (count: number, extra: (n: number) => Partial<PluginSidebarThread> = () => ({})) =>
  Array.from({ length: count }, (_, n) =>
    makeThread({ id: `t${n}`, title: `Thread ${n}`, projectId: n % 2 === 0 ? "proj_a" : "proj_b", createdAt: Date.now() - n * 60_000, ...extra(n) }),
  );

async function render(
  threads: PluginSidebarThread[],
  { prefs = {}, height = 600, listProps = {}, sections = [] }: { prefs?: Partial<Preferences>; height?: number; listProps?: Partial<PluginThreadListProps>; sections?: PluginSidebarSection[] } = {},
): Promise<RenderedSlot> {
  // Wide enough that bb's menus stay menus rather than a phone's drawers.
  await page.viewport(1024, height);
  const preferences = { ...defaultPreferences(), settleAfter: "never" as const, ...prefs };
  const slot = renderSlot(app.threadLists[0]!, { ...props, ...listProps }, {
    rpc: {
      listPreferences: () => ({ preferences }),
      setPreference: ({ key, value }: { key: string; value: unknown }) => ({ key, value }),
      resetPreference: ({ key }: { key: string }) => ({ key, value: null }),
      importPreferences: () => ({ status: "already-imported" as const, source: null, keys: [] }),
      listStamps: () => ({ stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {}, idleAt: {} } }),
      markSeen: () => ({ at: Date.now() }),
      clearSeen: () => ({ ok: true as const }),
      listScheduled: () => ({ status: "ready" as const, scheduled: {} }),
      listNotes: () => ({ notes: {} }),
    } as never,
    sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections },
    providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
    sdk: {
      threads: {
        defaultExecutionOptions: async () => null,
        update: async () => ({}),
        unpin: async () => ({}),
        reorderPinned: async () => ({}),
      } as never,
      projects: {
        get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
        branches: async () => ({ defaultBranch: "main" }),
      } as never,
      providers: { models: async () => ({ models: [] }) } as never,
      system: {
        config: async () => ({ primaryHostId: "host_1", generalSettings: { defaultProviderId: null }, serverAccess: { defaultProviderId: "claude-code" } }),
      } as never,
    },
  } as never);
  await screen.findAllByRole("link");
  await frames();
  return slot;
}

const anchorOf = (id: string) => document.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`);
const center = (element: Element, yAt = 0.5) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height * yAt };
};

/** bb's walk for shortcuts and next/previous: anchors and spacers in DOM order, skipping More. */
function walk(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-sidebar-thread-shortcut-target], [data-sidebar-windowed-nav]")]
    .filter((element) => element.closest('[data-sidebar-overflow="true"]') === null)
    .flatMap((element) =>
      element.hasAttribute("data-sidebar-windowed-nav")
        ? element.dataset.sidebarWindowedNav!.split(" ").map((pair) => pair.split(":")[0]!)
        : [element.dataset.sidebarThreadId!],
    );
}

describe("scrolling a windowed list", () => {
  it("keeps bb's keyboard walk, and so keys 1–9 and next and previous, the same as with every row mounted", async () => {
    await render(many(200), { height: 8_000 });
    await frames();
    const full = walk();
    expect(document.querySelectorAll("[data-sidebar-windowed-nav]")).toHaveLength(0);
    cleanup();
    await render(many(200), { height: 500 });
    for (let top = 0; top <= document.documentElement.scrollHeight; top += 700) {
      window.scrollTo(0, top);
      await frames();
      await frames();
      expect(walk(), `at ${top}`).toEqual(full);
      // bb's jump keys read only mounted row links, the first nine in DOM order.
      const jumps = [...document.querySelectorAll<HTMLElement>("[data-sidebar-thread-shortcut-target]")].slice(0, 9).map((anchor) => anchor.dataset.sidebarThreadId);
      expect(jumps, `keys 1–9 at ${top}`).toEqual(full.slice(0, 9));
      expect(document.querySelectorAll("[data-sidebar-windowed-nav]").length, `at ${top}`).toBeGreaterThan(0);
    }
  });

  it("sticks each group's header to the top while its group is in view, over no row of another group", async () => {
    await render(many(200), { height: 500 });
    for (let top = 0; top <= document.documentElement.scrollHeight; top += 250) {
      window.scrollTo(0, top);
      await frames();
      for (const section of document.querySelectorAll<HTMLElement>("section[data-sidebar-visibility-group]")) {
        const header = section.querySelector('[data-sidebar="group-label"]')!.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        if (box.top < 0 && box.bottom > header.height) expect(header.top, `${section.ariaLabel} at ${top}`).toBe(0);
        for (const row of document.querySelectorAll<HTMLElement>("[data-sidebar-rename-row]")) {
          if (section.contains(row)) continue;
          const rect = row.getBoundingClientRect();
          expect(rect.bottom <= header.top + 0.5 || rect.top >= header.bottom - 0.5, `${section.ariaLabel}'s header over another group's row at ${top}`).toBe(true);
        }
      }
    }
  });

  it("opens no hover card on rows that slide under a still pointer", async () => {
    await render(many(200), { height: 500 });
    const first = anchorOf("t0")!.parentElement!;
    await mouse("mouseMoved", center(first).x, center(first).y);
    await mouse("mouseMoved", center(first).x + 20, center(first).y);
    await sleep(100);
    for (let step = 0; step < 6; step += 1) {
      window.scrollBy(0, 400);
      await frames();
    }
    await sleep(800);
    expect(screen.queryByText("Harness")).toBeNull();
  });

  it("keeps the focused thread's row, the row renamed with its text and focus, and the row holding keyboard focus mounted however far it scrolls", async () => {
    await render(many(200), { height: 500, listProps: { activeThreadId: "t1" } });
    // Rows past the nine bb's jump keys keep mounted anyway.
    fireEvent.doubleClick(anchorOf("t24")!);
    const editor = await screen.findByRole("textbox", { name: "Thread name" });
    await userEvent.fill(editor, "Renamed");
    window.scrollTo(0, document.documentElement.scrollHeight);
    await frames();
    await frames();
    expect(anchorOf("t40")).toBeNull();
    expect(anchorOf("t1")).not.toBeNull();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Thread name" }).value).toBe("Renamed");
    expect(document.activeElement).toBe(editor);
    await userEvent.keyboard("{Escape}");
    window.scrollTo(0, 0);
    await frames();
    anchorOf("t26")!.focus();
    window.scrollTo(0, document.documentElement.scrollHeight);
    await frames();
    await frames();
    expect(anchorOf("t40")).toBeNull();
    expect(document.activeElement).toBe(anchorOf("t26"));
  });

  it("keeps the row an open menu belongs to mounted, with the menu anchored to it", async () => {
    await render(many(200), { height: 500 });
    const row = anchorOf("t28")!.parentElement!;
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    window.scrollTo(0, 3_000);
    await frames();
    await frames();
    await sleep(50);
    expect(anchorOf("t28")).not.toBeNull();
    expect(anchorOf("t40")).toBeNull();
    const button = trigger.getBoundingClientRect();
    const content = menu.getBoundingClientRect();
    // Radix places it below or above its anchor, 4 px off.
    expect(Math.min(Math.abs(content.top - button.bottom), Math.abs(content.bottom - button.top))).toBeLessThan(6);
    await userEvent.keyboard("{Escape}");
  });

  it("keeps the dragged row mounted while the list scrolls, and the drag goes on to its drop", async () => {
    // Tall enough that the target sits clear of dnd-kit's auto-scroll edge.
    const slot = await render(many(200), { height: 900 });
    const row = anchorOf("t22")!.parentElement!;
    const target = anchorOf("t26")!.parentElement!;
    await drag(center(row), center(target), async () => {
      expect(row.className).toMatch(/opacity-50/);
      window.scrollTo(0, 4_000);
      await frames();
      await frames();
      expect(anchorOf("t22")).not.toBeNull();
      expect(anchorOf("t40")).toBeNull();
      window.scrollTo(0, 0);
      await frames();
      await frames();
      // Scrolled away and back, the target row is mounted afresh.
      const again = anchorOf("t26")!.parentElement!;
      await mouse("mouseMoved", center(again).x, center(again).y + 1);
      await frames();
    });
    await waitFor(() =>
      expect(slot.inspection.sdkCalls).toContainEqual(expect.objectContaining({ method: "threads.update", args: [{ threadId: "t22", parentThreadId: "t26" }] })),
    );
  });
});

describe("the one drag", () => {
  const sections: PluginSidebarSection[] = [{ id: "sec_1", name: "Later" } as PluginSidebarSection];
  const tree = () => [
    makeThread({ id: "a", title: "Alpha", sectionId: null, createdAt: Date.now() - 1_000 }),
    makeThread({ id: "b", title: "Beta", createdAt: Date.now() - 2_000 }),
    makeThread({ id: "c", title: "Child", parentThreadId: "b", createdAt: Date.now() - 3_000 }),
    makeThread({ id: "l", title: "Later one", sectionId: "sec_1", createdAt: Date.now() - 4_000 }),
    makeThread({ id: "p1", title: "Pinned one", pinnedAt: Date.now(), isPinned: true, createdAt: Date.now() - 5_000 }),
    makeThread({ id: "p2", title: "Pinned two", pinnedAt: Date.now() - 1, isPinned: true, createdAt: Date.now() - 6_000 }),
  ];
  const rowOf = (id: string) => anchorOf(id)!.parentElement!;
  const header = (name: RegExp) => screen.getByRole("button", { name }).closest<HTMLElement>('[data-sidebar="group-label"]')!;

  it("nests a thread dropped on a row's middle half, drawing the ring over that row while over it", async () => {
    const slot = await render(tree(), { prefs: { organizationMode: "chronological", expandedChildren: ["b"] }, sections });
    await drag(center(rowOf("a")), center(rowOf("b")), async () => {
      expect(document.querySelector('[data-sidebar-nest-target="valid"]')?.getAttribute("data-drop-thread-id")).toBe("b");
    });
    await waitFor(() => expect(slot.inspection.sdkCalls).toContainEqual(expect.objectContaining({ method: "threads.update", args: [{ threadId: "a", parentThreadId: "b" }] })));
  });

  it("shows the red ring where nesting is blocked, nothing where the drop changes nothing, and does nothing on either drop", async () => {
    const slot = await render(tree(), { prefs: { organizationMode: "chronological", expandedChildren: ["b"] }, sections });
    await drag(center(rowOf("b")), center(rowOf("c")), async () => {
      expect(document.querySelector('[data-sidebar-nest-target="blocked"]')?.getAttribute("data-drop-thread-id")).toBe("c");
    });
    await drag(center(rowOf("c")), center(rowOf("b")), async () => {
      const feedback = document.querySelector<HTMLElement>('[data-sidebar-nest-target="unchanged"]');
      expect(feedback === null || getComputedStyle(feedback).boxShadow === "none").toBe(true);
    });
    await sleep(100);
    expect(slot.inspection.sdkCalls.filter((call) => call.method === "threads.update")).toEqual([]);
  });

  it("moves a thread into a section by its header, and a child out of its parent by its group's header", async () => {
    const slot = await render(tree(), { prefs: { organizationMode: "chronological", expandedChildren: ["b"] }, sections });
    await drag(center(rowOf("a")), center(header(/Later section/)));
    await waitFor(() => expect(slot.inspection.sdkCalls).toContainEqual(expect.objectContaining({ method: "threads.update", args: [{ threadId: "a", sectionId: "sec_1" }] })));
    await drag(center(rowOf("c")), center(header(/Threads section/)));
    await waitFor(() =>
      expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.update" && JSON.stringify(call.args).includes('"threadId":"c"'))).toBe(true),
    );
  });

  it("pins a thread dropped on Pinned, and reorders within Pinned by a row's top or bottom quarter, drawing the line there", async () => {
    const slot = await render(tree(), { prefs: { organizationMode: "chronological" }, sections });
    await drag(center(rowOf("a")), center(header(/Pinned section/)));
    await waitFor(() => expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "setPinned", threadId: "a" })));
    await drag(center(rowOf("p2")), center(rowOf("p1"), 0.1), async () => {
      expect(document.querySelector("[data-sidebar-reorder-placement]")?.getAttribute("data-sidebar-reorder-placement")).toBe("before");
    });
    await waitFor(() => expect(slot.inspection.sdkCalls.some((call) => call.method === "threads.reorderPinned")).toBe(true));
  });

  it("reorders groups by a dragged header and saves the order", async () => {
    const slot = await render(many(6), { prefs: { organizationMode: "project" } });
    const alpha = header(/Alpha section/);
    const beta = header(/Beta section/);
    await drag(center(beta), center(alpha, 0.2), async () => {
      expect(beta.className).toMatch(/opacity-50/);
    });
    await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "setPreference" && JSON.stringify(call.input).includes("sectionOrder"))).toBe(true));
  });

  it("treats a press that moves under 4 px as a click, keeps a double click a rename, and starts no drag from a row's buttons", async () => {
    let navigated = 0;
    await render(tree(), { prefs: { organizationMode: "chronological", expandedChildren: ["b"] }, sections, listProps: { onNavigate: () => (navigated += 1) } });
    const beta = rowOf("b");
    await drag(center(beta), { x: center(beta).x + 3, y: center(beta).y });
    expect(navigated).toBe(1);
    expect(beta.className).not.toMatch(/opacity-50/);
    await sleep(450);
    fireEvent.doubleClick(anchorOf("a")!);
    await screen.findByRole("textbox", { name: "Thread name" });
    await userEvent.keyboard("{Escape}");
    await userEvent.hover(beta);
    for (const name of [/child threads? of Beta/, /^Archive thread$/, /^Thread actions$/]) {
      const button = within(beta).getByRole("button", { name });
      await drag(center(button), { x: center(button).x, y: center(button).y + 60 }, async () => {
        expect(document.querySelector('[class*="opacity-50"][data-sidebar-rename-row]'), String(name)).toBeNull();
      });
      await userEvent.keyboard("{Escape}");
    }
  });

  it("opens the focused row's thread on Enter, as a click does", async () => {
    let navigated = 0;
    await render(tree(), { listProps: { onNavigate: () => (navigated += 1) } });
    anchorOf("a")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(navigated).toBe(1);
    expect(rowOf("a").className).not.toMatch(/opacity-50/);
  });
});

describe("the More popover", () => {
  it("scrolls its hidden groups and shows every row", async () => {
    await render(many(160), { prefs: { hiddenGroups: ["project:proj_b"] } });
    const more = screen.getByRole("button", { name: /^More: 1 hidden group$/ });
    more.scrollIntoView();
    await frames();
    fireEvent.click(more);
    const overflow = await waitFor(() => document.querySelector<HTMLElement>('[data-sidebar-overflow="true"]')!);
    const scroller = overflow.parentElement!;
    const seen = new Set<string>();
    for (let top = 0; top <= scroller.scrollHeight; top += 150) {
      scroller.scrollTop = top;
      await frames();
      await frames();
      for (const anchor of overflow.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")) seen.add(anchor.dataset.sidebarThreadId!);
    }
    const missing = many(160).map((thread) => thread.id).filter((id, n) => n % 2 === 1 && !seen.has(id));
    expect(missing, `scrollHeight ${scroller.scrollHeight}, clientHeight ${scroller.clientHeight}, top ${scroller.scrollTop}`).toEqual([]);
    expect(walk().some((id) => seen.has(id))).toBe(false);
  });
});
