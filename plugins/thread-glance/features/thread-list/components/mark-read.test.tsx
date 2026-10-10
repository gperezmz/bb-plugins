// @vitest-environment jsdom
// Mark all read and Mark tree read: every thread they mark shows
// read in the click's own commit, and bb is sent the reads behind it, six at
// a time, on a fake host, which holds reads until the test releases them,
// fails a read, and changes a thread while its read is pending. Once the list
// is mounted the clock is fake, so what the test sees follows from what it
// released, whatever the machine's speed.
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createFakeHost, loadWithFakeHost, mountList, serverState, type FakeHost } from "../testing/fake-host";
import { finishedUnread, makeThread, PROJECTS, T0 } from "../testing/fixtures";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", async (original) => ({ ...(await original<typeof import("sonner")>()), toast }));

type App = Awaited<ReturnType<typeof loadWithFakeHost>>;
let app: App;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadWithFakeHost();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  toast.error.mockClear();
});

interface Options {
  failRead?: (threadId: string) => boolean;
  finishedAt?: Record<string, number>;
}

/** Mounts the list on a fake host that holds every read, then fakes the clock. */
async function open(threads: PluginSidebarThread[], { failRead, finishedAt = {} }: Options = {}) {
  const host = createFakeHost({ threads, projects: PROJECTS, failRead, holdReads: true });
  const server = serverState({ settleAfter: "never" }, { stamps: { finishedAt } });
  const slot = mountList(app, server);
  await screen.findAllByRole("link");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
  await tick();
  return { host, slot };
}

/** Moves the fake clock on and lets what it set off land. */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Answers every held read, and lets bb's answers and the list's next frame land. */
async function release(host: FakeHost): Promise<void> {
  let settled = false;
  void host.markReadSettled().then(() => (settled = true));
  await act(async () => host.releaseReads());
  for (let step = 0; step < 100 && !settled; step += 1) await tick(1);
  expect(settled).toBe(true);
  await tick(50);
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openMenu(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });
  });
}

/** A row's own label says unread ("unread below" is its children). */
const UNREAD = /\bunread\b(?! below)/i;

/** A children chip saying something below is unread. */
const unreadBelow = () => screen.queryByRole("button", { name: /unread below/ });

function rowLabel(title: string): string {
  return screen.getByRole("link", { name: new RegExp(`Open ${title}\\b`) }).getAttribute("aria-label") ?? "";
}

function reads(slot: RenderedSlot): string[] {
  return slot.sdkCalls
    .filter((call) => call.method === "threads.markRead")
    .map((call) => (call.args[0] as { threadId: string }).threadId)
    .sort();
}

const unread = (id: string, patch: Partial<PluginSidebarThread> = {}) =>
  makeThread({ id, title: id.toUpperCase(), ...finishedUnread, ...patch });

it("shows every thread Mark all read counts read in the click's commit, from the list header", async () => {
  const { host, slot } = await open([unread("u1"), unread("u2", { projectId: "proj_b" }), unread("c", { parentThreadId: "u1", createdAt: T0 + 1 })]);
  expect(rowLabel("U1")).toMatch(UNREAD);
  await click(screen.getByRole("button", { name: "Mark all read" }));
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  expect(rowLabel("U2")).not.toMatch(UNREAD);
  expect(unreadBelow()).toBeNull();
  // Nothing is left unread, so the header drops Mark all read at once.
  expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  await release(host);
  expect(reads(slot)).toEqual(["c", "u1", "u2"]);
  expect(rowLabel("U1")).not.toMatch(UNREAD);
});

it("shows a group's threads read in the click's commit, from its menu, and no other group's, six reads at a time", async () => {
  const beta = Array.from({ length: 8 }, (_, n) => unread(`b${n}`, { projectId: "proj_b" }));
  const { host, slot } = await open([unread("a1"), ...beta]);
  await openMenu(screen.getByRole("button", { name: "Beta actions" }));
  await click(screen.getByRole("menuitem", { name: "Mark all read" }));
  expect(beta.filter((thread) => UNREAD.test(rowLabel(thread.displayTitle)))).toEqual([]);
  expect(rowLabel("A1")).toMatch(UNREAD);
  expect(reads(slot)).toHaveLength(6);
  await release(host);
  expect(host.markReadPeak).toBe(6);
  expect(reads(slot)).toEqual(beta.map((thread) => thread.id).sort());
});

async function markTreeRead(title: string): Promise<void> {
  const row = screen.getByRole("link", { name: new RegExp(`Open ${title}\\b`) }).parentElement!;
  await click(within(row).getByRole("button", { name: "Thread actions" }));
  await click(screen.getByRole("menuitem", { name: "Mark tree read" }));
}

it("shows a tree read in the click's commit, from Mark tree read in the root's menu", async () => {
  const { host, slot } = await open([makeThread({ id: "r", title: "Root" }), unread("c", { parentThreadId: "r", createdAt: T0 + 1 }), unread("d", { parentThreadId: "r", createdAt: T0 + 2 })]);
  expect(unreadBelow()).not.toBeNull();
  await markTreeRead("Root");
  expect(unreadBelow()).toBeNull();
  await release(host);
  expect(reads(slot)).toEqual(["c", "d"]);
});

it("sends at most six reads at once, one per counted thread, and marks done-unseen child threads seen in one request", async () => {
  const roots = Array.from({ length: 24 }, (_, n) => unread(`m${n}`));
  const children = [
    makeThread({ id: "k1", title: "K1", parentThreadId: "m0", createdAt: T0 + 1, latestAttentionAt: T0 + 20 }),
    makeThread({ id: "k2", title: "K2", parentThreadId: "m1", createdAt: T0 + 1, latestAttentionAt: T0 + 20 }),
  ];
  const { host, slot } = await open([...roots, ...children], { finishedAt: { k1: T0 + 20, k2: T0 + 20 } });
  await click(screen.getByRole("button", { name: "Mark all read" }));
  const dialog = screen.getByRole("alertdialog");
  // Done-unseen child threads count too.
  expect(within(dialog).getByText("Mark 26 threads read?")).toBeTruthy();
  await click(within(dialog).getByRole("button", { name: "Mark all read" }));
  expect(roots.filter((thread) => rowLabel(thread.displayTitle).match(UNREAD))).toEqual([]);
  expect(reads(slot)).toHaveLength(6);
  await release(host);
  expect(host.markReadPeak).toBe(6);
  expect(reads(slot)).toEqual([...roots, ...children].map((thread) => thread.id).sort());
  expect(slot.rpcCalls.filter((call) => call.method === "markSeen")).toEqual([
    expect.objectContaining({ input: { threadIds: ["k1", "k2"] } }),
  ]);
});

it("asks first above 20 threads, and cancelling sends nothing and changes nothing", async () => {
  const many = Array.from({ length: 21 }, (_, n) => unread(`m${n}`));
  const { slot } = await open(many);
  await click(screen.getByRole("button", { name: "Mark all read" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("Mark 21 threads read?")).toBeTruthy();
  expect(within(dialog).getByText("Every unread thread in the list, child threads included, will be marked read.")).toBeTruthy();
  await click(within(dialog).getByRole("button", { name: "Cancel" }));
  await tick(1_000);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(reads(slot)).toEqual([]);
  expect(slot.rpcCalls.some((call) => call.method === "markSeen")).toBe(false);
  expect(many.every((thread) => UNREAD.test(rowLabel(thread.displayTitle)))).toBe(true);
});

it.each(["Mark all read", "Cancel"])("shows the confirm it asked while it closes by %s", async (choice) => {
  // bb's stylesheet animates a closing dialog out, and Radix keeps it drawn
  // until the animation ends; jsdom applies no animation, so the dialog's style says it.
  const computed = window.getComputedStyle;
  const style = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const real = computed(element, pseudo);
    if (element.getAttribute("role") !== "alertdialog") return real;
    return new Proxy(real, {
      get: (target, key) =>
        key === "animationName" ? (element.getAttribute("data-state") === "closed" ? "exit" : "none") : Reflect.get(target, key, target),
    });
  });
  try {
    await open(Array.from({ length: 21 }, (_, n) => unread(`m${n}`)));
    await click(screen.getByRole("button", { name: "Mark all read" }));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: choice }));
    const closing = screen.getByRole("alertdialog", { hidden: true });
    expect(closing.dataset.state).toBe("closed");
    expect(within(closing).getByRole("heading", { hidden: true }).textContent).toBe("Mark 21 threads read?");
    expect(within(closing).getByText("Every unread thread in the list, child threads included, will be marked read.")).toBeTruthy();
    expect(within(closing).getAllByRole("button", { hidden: true }).map((button) => button.textContent)).toEqual(["Cancel", "Mark all read"]);
  } finally {
    style.mockRestore();
  }
});

it("shows a thread whose read fails unread again, silently from Mark all read", async () => {
  const { host } = await open([unread("u1"), unread("u2")], { failRead: (id) => id === "u2" });
  await click(screen.getByRole("button", { name: "Mark all read" }));
  expect(rowLabel("U2")).not.toMatch(UNREAD);
  await release(host);
  expect(rowLabel("U2")).toMatch(UNREAD);
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  expect(toast.error).not.toHaveBeenCalled();
});

it("shows one Couldn't mark read toast per failed thread from Mark tree read, each shown unread again", async () => {
  const { host } = await open(
    [makeThread({ id: "r", title: "Root" }), unread("c", { parentThreadId: "r", createdAt: T0 + 1 }), unread("d", { parentThreadId: "r", createdAt: T0 + 2 }), unread("e", { parentThreadId: "r", createdAt: T0 + 3 })],
    { failRead: (id) => id !== "c" },
  );
  await markTreeRead("Root");
  expect(unreadBelow()).toBeNull();
  await release(host);
  expect(toast.error.mock.calls.map(([message]) => message)).toEqual(["Couldn't mark read", "Couldn't mark read"]);
  expect(unreadBelow()).not.toBeNull();
});

it("shows a thread unread once bb says a new turn finished while its read was pending", async () => {
  const { host } = await open([unread("u1"), unread("u2")]);
  await click(screen.getByRole("button", { name: "Mark all read" }));
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  await act(async () => {
    host.updateThread("u1", { latestAttentionAt: T0 + 5_000 });
  });
  // bb's data is applied on the list's next frame.
  await tick(50);
  expect(rowLabel("U1")).toMatch(UNREAD);
  expect(rowLabel("U2")).not.toMatch(UNREAD);
  await release(host);
});
