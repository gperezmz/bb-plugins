// @vitest-environment jsdom
// Thread Glance's actions in bb's thread menu: where bb's menu puts them
// (AC20) and that they run through the window's lifecycle commands.
import { act, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadAction, PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeThread, PROJECTS } from "@/testing/fixtures";
import type { MenuData } from "./model/menu";
import { menuData, targetOf } from "./model/testing";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

type Registration = PluginThreadActionRegistration<unknown>;
let registrations: Registration[];

beforeAll(async () => {
  const app = await loadPluginApp(() => import("../../app"));
  registrations = app.threadActions;
});
afterEach(() => {
  cleanup();
  toasts.success.mockClear();
  toasts.error.mockClear();
});

/** bb 0.46's own thread actions, as its app bundle registers them, before any plugin's. */
const BB_ACTIONS: { label: string; group: string; order?: number }[] = [
  { label: "Open in split", group: "1_open" },
  { label: "New thread in environment", group: "2_organize", order: 10 },
  { label: "Copy thread link", group: "2_organize", order: 20 },
  { label: "Mark read", group: "2_organize", order: 30 },
  { label: "Pin", group: "2_organize", order: 40 },
  { label: "Rename", group: "2_organize", order: 60 },
  { label: "Archive", group: "4_lifecycle" },
  { label: "Delete", group: "4_lifecycle" },
];

/** The menu bb draws for `data`: sorted by group, then order (unset last), then registration order. */
function menuFor(thread: ReturnType<typeof makeThread>, data: MenuData) {
  const mine = registrations.flatMap((registration) => {
    const action = registration.item({ thread: targetOf(thread), data, sdk: {} as never, navigate: {} as never });
    return action === null ? [] : [{ label: action.label, group: registration.group, order: registration.order, action }];
  });
  const entries = [...BB_ACTIONS.map((entry) => ({ ...entry, action: null as PluginThreadAction | null })), ...mine];
  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.index - b.index,
    );
}

describe("registrations", () => {
  it("registers every action of the thread menu once", () => {
    expect(registrations.map((registration) => registration.id)).toEqual([
      "parent",
      "project",
      "copy-branch",
      "copy-thread-id",
      "snooze",
      "wake",
      "park",
      "resume",
      "settle",
      "unsettle",
      "notify-parent",
    ]);
  });
});

describe("where the actions sit in bb's menu (AC20)", () => {
  const idle = makeThread({ id: "t1", title: "Idle", environment: { branchName: "feat/x" } });
  const data = (() => {
    const now = Date.now();
    return {
      now,
      facts: new Map([["t1", { busy: false, woke: false, mark: "active" as const, branch: "feat/x", notifiable: false }]]),
      projects: new Map([["proj_a", { name: "Alpha", isPersonal: false, settingsHref: "/p" }]]),
      presets: [],
      machines: { count: 1 },
      commands: {} as never,
      notify: { values: new Map(), set: async () => {} },
      ports: {} as never,
    } satisfies MenuData;
  })();

  it("puts Parent… and Project after Open in split, the lifecycle actions after Pin and the copies after Copy thread link", () => {
    const labels = menuFor(idle, data).map((entry) => entry.label);
    expect(labels).toEqual([
      "Open in split",
      "Parent…",
      "Project",
      "New thread in environment",
      "Copy thread link",
      "Copy branch",
      "Copy thread ID",
      "Mark read",
      "Pin",
      "Snooze",
      "Park thread",
      "Settle",
      "Rename",
      "Archive",
      "Delete",
    ]);
  });

  it("offers Snooze, Park thread and Settle in the thread header's menu on a thread that is not busy", () => {
    const names = menuFor(idle, data).flatMap((entry) => (entry.action === null ? [] : [entry.label]));
    expect(names).toEqual(expect.arrayContaining(["Snooze", "Park thread", "Settle"]));
  });

  it("gives Snooze a choice list, so bb draws a submenu", () => {
    const snooze = menuFor(idle, data).find((entry) => entry.label === "Snooze")!;
    expect(snooze.action!.choices!.items.length).toBeGreaterThan(0);
  });
});

describe("the window's data", () => {
  it("runs Park through the lifecycle commands, with the threads and rows the window holds", async () => {
    const thread = makeThread({ id: "t1", title: "Idle" });
    const calls: string[] = [];
    let data: MenuData | undefined;
    const park = registrations.find((registration) => registration.id === "park")!;
    function Probe() {
      data = park.useData!({ threadIds: ["t1"] }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, {
      sidebarThreads: { status: "ready", threads: [thread], projects: PROJECTS },
      rpc: {
        park: async () => {
          calls.push("park");
          return { changes: [], reclaim: { stopped: false, closed: 0, left: 0 }, note: null };
        },
      } as never,
      sdk: { hosts: { list: async () => [{ id: "h1", name: "Laptop" }] } } as never,
    });
    await waitFor(() => expect(data?.machines).toEqual({ count: 1 }));
    expect(data!.facts.get("t1")).toEqual({ busy: false, woke: false, mark: "active", branch: "main", notifiable: false });
    expect(data!.presets.map((preset) => preset.label)).toContain("1 hour");

    const action = park.item({ thread: targetOf(thread), data, sdk: {} as never, navigate: {} as never })!;
    await act(async () => {
      await action.run({ requestRename: () => {} });
    });
    expect(calls).toEqual(["park"]);
    expect(toasts.success).toHaveBeenCalledWith("Thread parked", expect.anything());
  });

  it("opens a project's settings page in bb's own router, as a history entry it follows", async () => {
    let data: MenuData | undefined;
    const project = registrations.find((registration) => registration.id === "project")!;
    function Probe() {
      data = project.useData!({ threadIds: ["t1"] }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, { sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1" })], projects: PROJECTS } });
    await waitFor(() => expect(data).toBeDefined());
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    try {
      data!.ports.openPage(`/settings/projects/${PROJECTS[0]!.id}`);
      expect(window.location.pathname).toBe(`/settings/projects/${PROJECTS[0]!.id}`);
      expect(popped).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", popped);
      window.history.replaceState(null, "", "/");
    }
  });

  it("leaves the history and the page alone when the browser is already on the project's settings page", async () => {
    let data: MenuData | undefined;
    const project = registrations.find((registration) => registration.id === "project")!;
    function Probe() {
      data = project.useData!({ threadIds: ["t1"] }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, { sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1" })], projects: PROJECTS } });
    await waitFor(() => expect(data).toBeDefined());
    const href = `/settings/projects/${PROJECTS[0]!.id}`;
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    try {
      window.history.replaceState(null, "", href);
      const length = window.history.length;
      data!.ports.openPage(href);
      expect(window.history.length).toBe(length);
      expect(window.location.pathname).toBe(href);
      expect(popped).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", popped);
      window.history.replaceState(null, "", "/");
    }
  });

  it("marks Add local path unavailable when the machines cannot be listed", async () => {
    let data: MenuData | undefined;
    const project = registrations.find((registration) => registration.id === "project")!;
    function Probe() {
      data = project.useData!({ threadIds: ["t1"] }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, {
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1" })], projects: PROJECTS },
      sdk: { hosts: { list: async () => Promise.reject(new Error("offline")) } } as never,
    });
    await waitFor(() => expect(data?.machines).toBe("failed"));
  });

  it("lists the machines again when they could not be listed, or there were none, and stops once they were", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const answers: (() => Promise<{ id: string; name: string }[]>)[] = [
      () => Promise.reject(new Error("offline")),
      async () => [],
      async () => [{ id: "h1", name: "Laptop" }],
    ];
    const list = vi.fn(() => answers[Math.min(list.mock.calls.length - 1, answers.length - 1)]!());
    let data: MenuData | undefined;
    const project = registrations.find((registration) => registration.id === "project")!;
    function Probe() {
      data = project.useData!({ threadIds: ["t1"] }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, {
      sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1" })], projects: PROJECTS },
      sdk: { hosts: { list } } as never,
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(data?.machines).toBe("failed");
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(data?.machines).toEqual({ count: 0 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(data?.machines).toEqual({ count: 1 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(300_000)));
    expect(list).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe("Notify parent in the window (AC1, AC2)", () => {
  const child = makeThread({ id: "c1", parentThreadId: "p1" });
  const other = makeThread({ id: "c2", parentThreadId: "p1" });
  const fork = makeThread({ id: "f1", parentThreadId: "p1", originKind: "fork", sourceThreadId: "p1" });
  const root = makeThread({ id: "r1" });
  const notify = () => registrations.find((registration) => registration.id === "notify-parent")!;

  /** Mounts the menu data for the ids the test sets, and gives the data and the way to change them. */
  function mountData(sdk: unknown, initial: string[]) {
    const view: { data?: MenuData; setIds?: (ids: string[]) => void } = {};
    function Probe() {
      const [ids, setIds] = useState(initial);
      view.setIds = setIds;
      view.data = notify().useData!({ threadIds: ids }) as MenuData;
      return null;
    }
    renderSlot({ component: Probe }, {}, {
      sidebarThreads: { status: "ready", threads: [child, other, fork, root], projects: PROJECTS },
      sdk: sdk as never,
    });
    return view;
  }
  const itemFor = (thread: ReturnType<typeof makeThread>, data: MenuData) =>
    notify().item({ thread: targetOf(thread), data, sdk: {} as never, navigate: {} as never });

  it("puts Notify parent after the lifecycle actions and before Rename on a child, and nowhere on a root thread or a fork", () => {
    const { data } = menuData([child, root, fork]);
    expect(menuFor(child, data).map((entry) => entry.label)).toEqual([
      "Open in split",
      "Parent…",
      "Project",
      "New thread in environment",
      "Copy thread link",
      "Copy branch",
      "Copy thread ID",
      "Mark read",
      "Pin",
      "Snooze",
      "Park thread",
      "Settle",
      "Notify parent",
      "Rename",
      "Archive",
      "Delete",
    ]);
    for (const thread of [root, fork]) {
      expect(menuFor(thread, data).map((entry) => entry.label)).not.toContain("Notify parent");
    }
  });

  it("reads bb's setting for a child only and shows it as chosen", async () => {
    const get = vi.fn(async ({ threadId }: { threadId: string }) => ({ id: threadId, parentNotifications: threadId === "c1" ? "stuck" : "off" }));
    const view = mountData({ threads: { get } }, ["c1", "f1", "r1"]);
    await waitFor(() => expect(view.data!.notify.values.get("c1")).toBe("stuck"));
    expect(get.mock.calls).toEqual([[{ threadId: "c1" }]]);
    const action = itemFor(child, view.data!)!;
    expect(action.choices!.items.find((item) => item.selected)).toMatchObject({ id: "stuck", label: "Only when stuck" });
  });

  it("sets bb's setting and then shows the pick as chosen", async () => {
    const update = vi.fn(async (args: { threadId: string; parentNotifications: string }) => ({ id: args.threadId, parentNotifications: args.parentNotifications }));
    const get = vi.fn(async () => ({ id: "c1", parentNotifications: "auto" }));
    const view = mountData({ threads: { get, update } }, ["c1"]);
    await waitFor(() => expect(view.data!.notify.values.get("c1")).toBe("auto"));

    await act(async () => {
      await itemFor(child, view.data!)!.run({ value: "stuck", requestRename: () => {} });
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({ threadId: "c1", parentNotifications: "stuck" });
    expect(itemFor(child, view.data!)!.choices!.items.filter((item) => item.selected).map((item) => item.id)).toEqual(["stuck"]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("leaves the shown value and tells the person when bb refuses the change", async () => {
    const get = vi.fn(async () => ({ id: "c1", parentNotifications: "auto" }));
    const update = vi.fn(async () => Promise.reject(new Error("Thread is gone")));
    const view = mountData({ threads: { get, update } }, ["c1"]);
    await waitFor(() => expect(view.data!.notify.values.get("c1")).toBe("auto"));

    await act(async () => {
      await itemFor(child, view.data!)!.run({ value: "off", requestRename: () => {} });
    });
    expect(toasts.error).toHaveBeenCalledWith("Thread is gone");
    expect(view.data!.notify.values.get("c1")).toBe("auto");
  });

  it("offers the choices with none chosen when bb's setting cannot be read", async () => {
    const get = vi.fn(async () => Promise.reject(new Error("offline")));
    const view = mountData({ threads: { get } }, ["c1"]);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const action = itemFor(child, view.data!)!;
    expect(action.choices!.items.some((item) => item.selected)).toBe(false);
  });

  it("reads a thread again each time it enters the menus' set, and the others not at all", async () => {
    const get = vi.fn(async ({ threadId }: { threadId: string }) => ({ id: threadId, parentNotifications: "auto" }));
    const view = mountData({ threads: { get } }, ["c1"]);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => view.setIds!(["c1", "c2"]));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith({ threadId: "c2" });
    await act(async () => view.setIds!(["c2"]));
    await act(async () => view.setIds!(["c1", "c2"]));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(get).toHaveBeenLastCalledWith({ threadId: "c1" });
  });

  /** A promise the test settles by hand. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
  }

  it("keeps a pick shown when the read it overtook answers afterwards with the old value", async () => {
    const read = deferred<{ id: string; parentNotifications: string }>();
    const update = vi.fn(async (args: { threadId: string; parentNotifications: string }) => ({ id: args.threadId, parentNotifications: args.parentNotifications }));
    const view = mountData({ threads: { get: () => read.promise, update } }, ["c1"]);
    await waitFor(() => expect(view.data).toBeDefined());

    await act(async () => {
      await itemFor(child, view.data!)!.run({ value: "off", requestRename: () => {} });
    });
    expect(view.data!.notify.values.get("c1")).toBe("off");
    await act(async () => read.resolve({ id: "c1", parentNotifications: "auto" }));
    expect(view.data!.notify.values.get("c1")).toBe("off");
  });

  it("drops a read that answers after the menu data unmounted, and starts again from nothing", async () => {
    const stale = deferred<{ id: string; parentNotifications: string }>();
    const first = mountData({ threads: { get: () => stale.promise } }, ["c1"]);
    await waitFor(() => expect(first.data).toBeDefined());
    cleanup();

    const second = mountData({ threads: { get: () => new Promise(() => {}) } }, ["c1"]);
    await waitFor(() => expect(second.data).toBeDefined());
    await act(async () => stale.resolve({ id: "c1", parentNotifications: "stuck" }));
    expect(second.data!.notify.values.has("c1")).toBe(false);
  });

  it("shows the last pick when an earlier pick's answer arrives after it", async () => {
    const answers = new Map<string, ReturnType<typeof deferred<{ id: string; parentNotifications: string }>>>();
    const update = vi.fn((args: { threadId: string; parentNotifications: string }) => {
      const answer = deferred<{ id: string; parentNotifications: string }>();
      answers.set(args.parentNotifications, answer);
      return answer.promise;
    });
    const get = vi.fn(async () => ({ id: "c1", parentNotifications: "auto" }));
    const view = mountData({ threads: { get, update } }, ["c1"]);
    await waitFor(() => expect(view.data!.notify.values.get("c1")).toBe("auto"));

    let picks: Promise<void>[] = [];
    await act(async () => {
      picks = ["off", "stuck"].map((value) => itemFor(child, view.data!)!.run({ value, requestRename: () => {} }) as Promise<void>);
    });
    await act(async () => answers.get("stuck")!.resolve({ id: "c1", parentNotifications: "stuck" }));
    await act(async () => answers.get("off")!.resolve({ id: "c1", parentNotifications: "off" }));
    await act(async () => void (await Promise.all(picks)));
    expect(view.data!.notify.values.get("c1")).toBe("stuck");
  });

  it("drops a pick's answer that arrives after the menu data unmounted", async () => {
    const answer = deferred<{ id: string; parentNotifications: string }>();
    const first = mountData({ threads: { get: async () => ({ id: "c1", parentNotifications: "auto" }), update: () => answer.promise } }, ["c1"]);
    await waitFor(() => expect(first.data!.notify.values.get("c1")).toBe("auto"));
    let pick: Promise<void> = Promise.resolve();
    await act(async () => {
      pick = itemFor(child, first.data!)!.run({ value: "off", requestRename: () => {} }) as Promise<void>;
    });
    cleanup();

    const second = mountData({ threads: { get: () => new Promise(() => {}) } }, ["c1"]);
    await waitFor(() => expect(second.data).toBeDefined());
    await act(async () => answer.resolve({ id: "c1", parentNotifications: "off" }));
    await act(async () => void (await pick));
    expect(second.data!.notify.values.has("c1")).toBe(false);
  });

  it("shows the threads that were read when another thread read with them could not be", async () => {
    const get = vi.fn(async ({ threadId }: { threadId: string }) =>
      threadId === "c1" ? Promise.reject(new Error("gone")) : { id: threadId, parentNotifications: "off" },
    );
    const view = mountData({ threads: { get } }, ["c1", "c2"]);
    await waitFor(() => expect(view.data!.notify.values.get("c2")).toBe("off"));
    expect(view.data!.notify.values.has("c1")).toBe(false);
  });
});
