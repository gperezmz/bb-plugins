// @vitest-environment jsdom
// The list's data across mounts of the list within one plugin lifetime, as
// bb unmounts the sidebar for its Settings and Plugins pages: what a list
// mounted again draws first, and what it asks for, with and without the
// plugin's component in bb's app overlay slot; a realtime reconnect; the
// first-run import once per device; and the records `sync` leaves out.
// The clock is fake throughout, so what a test sees follows from how far it
// moved the clock, whatever the machine's speed.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { CLIENT_PREFERENCES_STORAGE_KEY, IMPORT_ANSWER_STORAGE_KEY } from "@/shared/preferences";
import { createFakeServer, failedUnread, finishedUnread, makeThread, PROJECTS, T0, type FakeServer } from "../testing/fixtures";
import { endPluginLifetime } from "./lifetime";

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

const props: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate() {},
  searchQuery: "",
};

/** bb's calls the list makes, each answered at once and logged. */
function sdk() {
  return {
    threads: { defaultExecutionOptions: async () => null } as never,
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
  };
}

/** The list, mounted as bb mounts it, against `server`. */
function mountList(server: FakeServer, threads: PluginSidebarThread[], extra: object = {}): RenderedSlot {
  return server.attach(
    renderSlot(app.threadLists[0]!, props, {
      rpc: server.handlers as never,
      sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
      providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
      sdk: sdk(),
      ...extra,
    }),
  );
}

/** The plugin's component in bb's app overlay slot. */
function mountOverlay(server: FakeServer, extra: object = {}): RenderedSlot {
  return server.attach(renderSlot(app.appOverlays[0]!, {}, { rpc: server.handlers as never, sdk: sdk(), ...extra }));
}

/** Leaves for bb's Settings page: the list unmounts and hears nothing more. */
function leave(server: FakeServer, list: RenderedSlot): void {
  server.detach(list);
  list.unmount();
}

/** Moves the fake clock on 20 ms and lets what it set off land. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(20));

/**
 * `query`'s answer once it gives one, moving the fake clock on 50 ms at a time
 * for up to a second, as `findBy` and `waitFor` poll on a real one.
 */
async function find<T>(query: () => T): Promise<T> {
  for (let waited = 0; ; waited += 50) {
    try {
      return query();
    } catch (error) {
      if (waited >= 1_000) throw error;
    }
    await act(() => vi.advanceTimersByTimeAsync(50));
  }
}

/** Opens a row's Details dialog, where its done note shows. */
async function details(title: string): Promise<HTMLElement> {
  const row = (await find(() => screen.getByRole("link", { name: new RegExp(`Open ${title}\\b`) }))).parentElement!;
  const trigger = within(row).getByRole("button", { name: "Thread actions" });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
  fireEvent.click(await find(() => screen.getByRole("menuitem", { name: "Details" })));
  return find(() => screen.getByRole("dialog"));
}

const threads = () => [
  makeThread({ id: "w", title: "Worker", status: "active", runtimeStatus: "active" }),
  makeThread({ id: "f", title: "Broken", status: "error" }),
  makeThread({ id: "s", title: "Later", queuedWork: "waiting" }),
];
/** The same threads after the ones that ran finished or failed while the list was away. */
const finishedThreads = () => [
  makeThread({ id: "w", title: "Worker", ...finishedUnread }),
  makeThread({ id: "f", title: "Broken", ...failedUnread }),
  makeThread({ id: "s", title: "Later", queuedWork: "waiting" }),
];

describe("a list mounted again beside the app overlay's keeper", () => {
  it("asks for nothing and draws every change made while it was away on its first draw", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const overlay = mountOverlay(server);
    const first = mountList(server, threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    leave(server, first);

    await server.stamp("finishedAt", ["w"], Date.now());
    await server.note("w", { done: { kind: "done", text: "Shipped the fix", at: T0 } });
    await server.note("f", { failed: { kind: "failed", text: "Out of credits", at: T0 } });
    await server.setScheduled({ s: Date.now() + 3_600_000 });
    await server.setPreference("organizationMode", "machine");
    const callsBefore = server.calls.length;

    const again = mountList(server, finishedThreads());
    // The first draw, before anything answers.
    expect(screen.getByText("Out of credits")).toBeTruthy();
    expect(screen.getAllByLabelText(/Scheduled message/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Machines" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Worker/ }).getAttribute("aria-label")).toMatch(/unread/i);
    await settle();
    expect(server.calls.slice(callsBefore)).toEqual([]);
    expect(again.inspection.rpcCalls).toEqual([]);
    expect(again.inspection.sdkCalls).toEqual([]);
    expect(overlay.inspection.rpcCalls.map((call) => call.method)).toEqual(["importPreferences", "sync"]);
    expect(within(await details("Worker")).getByText("Shipped the fix")).toBeTruthy();
  });

  it("draws the Branch line on its first draw once the default branch was known in the plugin's lifetime", async () => {
    localStorage.setItem(CLIENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ density: "compact", branchLine: true }));
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    mountOverlay(server);
    const onBranch = [makeThread({ id: "b", title: "Topic", environment: { branchName: "fix/login" } })];
    const first = mountList(server, onBranch);
    await find(() => expect(screen.getByRole("link", { name: /Open Topic/ }).parentElement!.textContent).toContain("fix/login"));
    leave(server, first);
    const again = mountList(server, onBranch);
    expect(screen.getByRole("link", { name: /Open Topic/ }).parentElement!.textContent).toContain("fix/login");
    await settle();
    expect(again.inspection.sdkCalls).toEqual([]);
  });
});

describe("a list mounted again where bb has no app overlay slot", () => {
  it("asks one sync for what changed while it was away, and draws once it has it", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const first = mountList(server, threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    leave(server, first);

    await server.note("f", { failed: { kind: "failed", text: "Out of credits", at: T0 } });
    await server.setPreference("organizationMode", "machine");

    const again = mountList(server, finishedThreads());
    // It does not draw what it holds from before it left.
    expect(screen.queryByRole("link", { name: /Open Broken/ })).toBeNull();
    expect(await find(() => screen.getByText("Out of credits"))).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Machines" })).toBeTruthy();
    await settle();
    expect(again.inspection.rpcCalls.map((call) => call.method)).toEqual(["sync"]);
    expect(again.inspection.rpcCalls[0]!.input).toMatchObject({ since: { epoch: server.epoch } });
    expect(again.inspection.sdkCalls).toEqual([]);
  });
});

describe("a realtime reconnect", () => {
  it("shows every change made while the connection was down, without a reload", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const list = mountList(server, threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    await list.behavior.setRealtimeConnectionState("reconnecting");
    // Signals sent while the connection is down never arrive.
    server.detach(list);
    await server.note("f", { failed: { kind: "failed", text: "Out of credits", at: T0 } });
    await server.setScheduled({ s: Date.now() + 3_600_000 });
    await server.setPreference("organizationMode", "machine");
    server.attach(list);
    expect(screen.queryByText("Out of credits")).toBeNull();
    const before = list.inspection.rpcCalls.length;
    await list.behavior.setRealtimeConnectionState("connected");
    expect(await find(() => screen.getByText("Out of credits"))).toBeTruthy();
    expect(screen.getAllByLabelText(/Scheduled message/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Machines" })).toBeTruthy();
    expect(list.inspection.rpcCalls.slice(before).map((call) => call.method)).toEqual(["sync"]);
  });
});

describe("a first load", () => {
  it("asks one sync when the app overlay's keeper and the list mount in one commit, as bb mounts them", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const Overlay = app.appOverlays[0]!.component;
    const List = app.threadLists[0]!.component;
    const page = server.attach(
      renderSlot(
        {
          component: () => (
            <>
              <Overlay />
              <List {...props} />
            </>
          ),
        },
        {},
        {
          rpc: server.handlers as never,
          sidebarThreads: { status: "ready", threads: threads(), projects: PROJECTS, sections: [] },
          providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
          sdk: sdk(),
        },
      ),
    );
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect(page.inspection.rpcCalls.filter((call) => call.method === "sync")).toHaveLength(1);
  });

  it("asks one sync, once realtime connects, when the page loads before its socket is up", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const list = mountList(server, threads(), { realtimeConnectionState: "connecting" });
    await settle();
    expect(list.inspection.rpcCalls.map((call) => call.method)).not.toContain("sync");
    await list.behavior.setRealtimeConnectionState("connected");
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect(list.inspection.rpcCalls.filter((call) => call.method === "sync")).toHaveLength(1);
  });
});

describe("the first-run import", () => {
  it("is sent once per device, across remounts and reloads, once an answer came", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const first = mountList(server, threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect(first.inspection.rpcCalls.map((call) => call.method).slice(0, 2)).toEqual(["importPreferences", "sync"]);
    expect(JSON.parse(localStorage.getItem(IMPORT_ANSWER_STORAGE_KEY)!)).toMatchObject({ status: "already-imported" });
    leave(server, first);
    const again = mountList(server, threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    leave(server, again);
    // A reload of the app, or of the plugin after an update, starts a new lifetime; the device keeps its record.
    endPluginLifetime();
    const reloaded = mountList(createFakeServer({ preferences: { settleAfter: "never" } }), threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect([...again.inspection.rpcCalls, ...reloaded.inspection.rpcCalls].map((call) => call.method)).not.toContain("importPreferences");
  });

  it("is sent again on the next load when it got no answer", async () => {
    const server = createFakeServer({ preferences: { settleAfter: "never" } });
    const failing = {
      ...server.handlers,
      importPreferences: () => {
        throw new Error("server restarting");
      },
    };
    const first = mountList(server, threads(), { rpc: failing });
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect(localStorage.getItem(IMPORT_ANSWER_STORAGE_KEY)).toBeNull();
    leave(server, first);
    endPluginLifetime();
    const next = mountList(createFakeServer({ preferences: { settleAfter: "never" } }), threads());
    await find(() => screen.getByRole("link", { name: /Open Worker/ }));
    await settle();
    expect(next.inspection.rpcCalls.map((call) => call.method)).toContain("importPreferences");
  });
});

describe("records sync leaves out", () => {
  const failedNote = { failed: { kind: "failed" as const, text: "Out of credits", at: T0 } };

  it("fetches by id, in one batch, the archived threads Show archived brings into the list", async () => {
    const server = createFakeServer({
      preferences: { settleAfter: "never", showArchived: true },
      notes: { a1: failedNote, a2: { failed: { ...failedNote.failed, text: "Disk full" } } },
      stamps: { finishedAt: { a1: T0 + 5, a2: T0 + 6 } },
      archived: ["a1", "a2"],
    });
    const archived = [
      makeThread({ id: "a1", title: "Old one", status: "error", isArchived: true, archivedAt: T0 + 10 }),
      makeThread({ id: "a2", title: "Old two", status: "error", isArchived: true, archivedAt: T0 + 10 }),
    ];
    const list = mountList(server, [...threads(), ...archived]);
    expect(await find(() => screen.getByText("Out of credits"))).toBeTruthy();
    expect(await find(() => screen.getByText("Disk full"))).toBeTruthy();
    const fetches = list.inspection.rpcCalls.filter((call) => call.method === "fetchArchived");
    expect(fetches).toHaveLength(1);
    expect((fetches[0]!.input as { threadIds: string[] }).threadIds).toEqual(expect.arrayContaining(["a1", "a2"]));
  });

  it("fetches the record of a thread unarchived without the server hearing, once", async () => {
    // The server still holds the child as archived, so `sync` leaves it out.
    const server = createFakeServer({ preferences: { settleAfter: "never" }, notes: { c: failedNote }, archived: ["c"] });
    const unarchived = [makeThread({ id: "p", title: "Parent" }), makeThread({ id: "c", title: "Child", parentThreadId: "p", status: "error" })];
    const list = mountList(server, unarchived);
    fireEvent.click(await find(() => screen.getByRole("button", { name: /Show 1 child thread of Parent/ })));
    expect(await find(() => screen.getByText("Out of credits"))).toBeTruthy();
    await settle();
    leave(server, list);
    mountList(server, unarchived);
    await settle();
    expect(server.calls.filter((call) => call.method === "fetchArchived")).toHaveLength(1);
  });
});
