// @vitest-environment jsdom
// The list as the store draws it: the clock's deadlines, a tree that
// settles while focused, and the preferences the settings panel and the
// list share, each seen on the list bb mounts.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/signals";
import { createFakeServer, makeThread, PROJECTS } from "../testing/fixtures";

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

const HOUR = 3_600_000;

function render(
  threads: PluginSidebarThread[],
  {
    prefs = {},
    stamps = {},
    scheduled = {},
    activeThreadId = null,
  }: {
    prefs?: Partial<Preferences>;
    stamps?: Partial<Record<string, Record<string, number>>>;
    scheduled?: Record<string, number>;
    activeThreadId?: string | null;
  } = {},
) {
  return renderSlot(
    app.threadLists[0]!,
    { activeThreadId, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" },
    {
      rpc: createFakeServer({ preferences: { settleAfter: "never", ...prefs }, stamps, scheduled }).handlers as never,
      sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
      providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
      sdk: {
        threads: { defaultExecutionOptions: async () => null } as never,
        projects: {
          get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
          branches: async () => ({ defaultBranch: "main" }),
        } as never,
        providers: { models: async () => ({ models: [] }) } as never,
      },
    },
  );
}

/** Moves the faked clock and lets what it set off land. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const label = (title: string) => screen.getByRole("link", { name: new RegExp(`^Open ${title}\\b`) }).getAttribute("aria-label")!;

describe("the clock", () => {
  it("shows a scheduled send reaching its time within a second, between two minute ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const now = Date.now();
    render([makeThread({ id: "s", title: "Sender", queuedWork: "waiting" })], { scheduled: { s: now + 20_000 } });
    await advance(0);
    expect(label("Sender")).toMatch(/Scheduled message/);
    await advance(19_000);
    expect(label("Sender")).toMatch(/Scheduled message/);
    // The send is due at 20 s; the next minute tick is 40 s after it.
    await advance(1_000 + 999);
    expect(label("Sender")).toMatch(/Message waiting to send/);
  });

  it("shows a failure becoming an Orphaned failure within a second, between two minute ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const now = Date.now();
    render(
      [
        makeThread({ id: "p", title: "Parent", createdAt: now - HOUR, latestAttentionAt: now - HOUR, lastReadAt: now - HOUR, updatedAt: now - HOUR }),
        makeThread({
          id: "c",
          title: "Child",
          parentThreadId: "p",
          status: "error",
          createdAt: now - HOUR,
          latestAttentionAt: now - 2_000,
          lastReadAt: now - HOUR,
          updatedAt: now - 2_000,
        }),
      ],
      { stamps: { idleAt: { p: now - HOUR } } },
    );
    await advance(0);
    // The child failed 2 s ago under an idle parent: orphaned 3 s from now.
    expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
    await advance(2_000);
    expect(screen.queryByRole("button", { name: /need you/ })).toBeNull();
    await advance(1_000 + 999);
    expect(screen.getByRole("button", { name: "1 need you" })).toBeTruthy();
  });

  it("does not tick while the window is hidden, and ticks once when it is shown", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const now = Date.now();
    render([makeThread({ id: "t", title: "Aging", createdAt: now - 30_000, latestAttentionAt: now - 30_000, lastReadAt: now })]);
    await advance(0);
    const time = () => within(screen.getByRole("link", { name: /^Open Aging\b/ }).parentElement!).getByTitle(/^Finished/).textContent;
    expect(time()).toBe("now");
    const hide = (hidden: boolean) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    hide(true);
    await advance(3 * 60_000);
    expect(time()).toBe("now");
    await act(async () => hide(false));
    expect(time()).toBe("3m");
    Reflect.deleteProperty(document, "visibilityState");
  });
});

describe("a tree that settles while it holds the focused thread", () => {
  it("stays where it is in the render where it settles, its row never leaving the list", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const now = Date.now();
    // Its last activity is 12 hours old but for 30 s: the next minute tick settles it.
    const almost = now - 12 * HOUR + 30_000;
    render(
      [
        makeThread({ id: "live", title: "Live", createdAt: now, latestAttentionAt: now, lastReadAt: now }),
        makeThread({ id: "f", title: "Focused", createdAt: almost, latestAttentionAt: almost, lastReadAt: almost }),
        makeThread({ id: "old", title: "Old", createdAt: now - 48 * HOUR, latestAttentionAt: now - 48 * HOUR, lastReadAt: now }),
      ],
      { prefs: { settleAfter: "12h" }, activeThreadId: "f" },
    );
    await advance(0);
    const row = screen.getByRole("link", { name: /^Open Focused\b/ });
    expect(screen.getByRole("button", { name: "Show 1 settled thread tree" })).toBeTruthy();
    await advance(60_000);
    // It settled, and was held: the fold counts it out, and its row is the
    // one drawn before, never unmounted into the closed fold and back.
    expect(screen.getByRole("button", { name: "Show 1 settled thread tree" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Open Focused\b/ })).toBe(row);
  });
});

describe("the preferences the settings panel and the list share", () => {
  const rowHeight = (title: string) => screen.getByRole("link", { name: new RegExp(`^Open ${title}\\b`) }).parentElement!.className;

  it("shows a change made in the settings panel in the list at once", async () => {
    render([makeThread({ id: "t", title: "Row" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Thread Glance settings" }));
    const panel = await screen.findByRole("dialog");
    expect(rowHeight("Row")).toContain("h-7");
    fireEvent.click(within(panel).getByRole("radio", { name: "Comfortable" }));
    expect(rowHeight("Row")).toContain("h-8");
    fireEvent.click(within(panel).getByRole("radio", { name: "Machine" }));
    expect(screen.getByRole("heading", { name: "Machines" })).toBeTruthy();
  });

  it("shows a change made elsewhere in the list and the open settings panel at once", async () => {
    const slot = render([makeThread({ id: "t", title: "Row" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Thread Glance settings" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("radio", { name: "Project" }).getAttribute("aria-checked")).toBe("true");
    await slot.emitRealtime(CHANNELS.preferences, { key: "organizationMode", value: "machine" });
    expect(within(panel).getByRole("radio", { name: "Machine" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("heading", { name: "Machines" })).toBeTruthy();
  });
});
