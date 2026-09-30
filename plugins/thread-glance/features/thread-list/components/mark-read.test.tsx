// @vitest-environment jsdom
// Mark all read and Mark read on a thread tree: every thread they mark shows
// read in the click's own commit, and bb is sent the reads behind it, six at
// a time, on the harness's fake host, which can take its time answering,
// fail a read, and change a thread while its read is pending.
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createFakeHost, loadWithFakeHost, mountList, serverState, type FakeHost } from "@/perf/harness/fake-host";
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
  cleanup();
  localStorage.clear();
  toast.error.mockClear();
});

interface Options {
  markReadMs?: number;
  failRead?: (threadId: string) => boolean;
  finishedAt?: Record<string, number>;
}

async function open(threads: PluginSidebarThread[], { markReadMs = 50, failRead, finishedAt = {} }: Options = {}) {
  const host = createFakeHost({ threads, projects: PROJECTS, markReadMs, failRead });
  const server = serverState({ settleAfter: "never" });
  server.stamps.finishedAt = finishedAt;
  const slot = mountList(app, server);
  await screen.findAllByRole("link");
  return { host, slot };
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

async function settled(host: FakeHost): Promise<void> {
  await act(async () => {
    await host.markReadSettled();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const unread = (id: string, patch: Partial<PluginSidebarThread> = {}) =>
  makeThread({ id, title: id.toUpperCase(), ...finishedUnread, ...patch });

it("shows every thread Mark all read counts read in the click's commit, from the list header", async () => {
  const { host, slot } = await open([unread("u1"), unread("u2", { projectId: "proj_b" }), unread("c", { parentThreadId: "u1", createdAt: T0 + 1 })]);
  expect(rowLabel("U1")).toMatch(UNREAD);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  });
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  expect(rowLabel("U2")).not.toMatch(UNREAD);
  expect(unreadBelow()).toBeNull();
  // Nothing is left unread, so the header drops Mark all read at once.
  expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  await settled(host);
  expect(reads(slot)).toEqual(["c", "u1", "u2"]);
  expect(rowLabel("U1")).not.toMatch(UNREAD);
});

it("shows a group's threads read in the click's commit, from its menu, and no other group's, six reads at a time", async () => {
  const beta = Array.from({ length: 8 }, (_, n) => unread(`b${n}`, { projectId: "proj_b" }));
  const { host, slot } = await open([unread("a1"), ...beta]);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Beta actions" }), { button: 0, pointerType: "mouse" });
  const item = await screen.findByRole("menuitem", { name: "Mark all read" });
  await act(async () => {
    fireEvent.click(item);
  });
  expect(beta.filter((thread) => UNREAD.test(rowLabel(thread.displayTitle)))).toEqual([]);
  expect(rowLabel("A1")).toMatch(UNREAD);
  expect(reads(slot)).toHaveLength(6);
  await settled(host);
  expect(host.markReadPeak).toBe(6);
  expect(reads(slot)).toEqual(beta.map((thread) => thread.id).sort());
});

it("shows a tree read in the click's commit, from the root's hover action and from its menu", async () => {
  const tree = () => [makeThread({ id: "r", title: "Root" }), unread("c", { parentThreadId: "r", createdAt: T0 + 1 }), unread("d", { parentThreadId: "r", createdAt: T0 + 2 })];
  const { host, slot } = await open(tree());
  const row = screen.getByRole("link", { name: /Open Root/ }).parentElement!;
  expect(unreadBelow()).not.toBeNull();
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "Mark read" }));
  });
  expect(unreadBelow()).toBeNull();
  await settled(host);
  expect(reads(slot)).toEqual(["c", "d"]);
  cleanup();

  const again = await open(tree());
  const menuRow = screen.getByRole("link", { name: /Open Root/ }).parentElement!;
  fireEvent.pointerDown(within(menuRow).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
  const item = await screen.findByRole("menuitem", { name: "Mark read" });
  await act(async () => {
    fireEvent.click(item);
  });
  expect(unreadBelow()).toBeNull();
  await settled(again.host);
  expect(reads(again.slot)).toEqual(["c", "d"]);
});

it("sends at most six reads at once, one per counted thread, and marks done-unseen child threads seen in one request", async () => {
  const roots = Array.from({ length: 24 }, (_, n) => unread(`m${n}`));
  const children = [
    makeThread({ id: "k1", title: "K1", parentThreadId: "m0", createdAt: T0 + 1, latestAttentionAt: T0 + 20 }),
    makeThread({ id: "k2", title: "K2", parentThreadId: "m1", createdAt: T0 + 1, latestAttentionAt: T0 + 20 }),
  ];
  const { host, slot } = await open([...roots, ...children], { finishedAt: { k1: T0 + 20, k2: T0 + 20 } });
  fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  const dialog = await screen.findByRole("alertdialog");
  // Done-unseen child threads count too.
  expect(within(dialog).getByText("Mark 26 threads read?")).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }));
  });
  expect(roots.filter((thread) => rowLabel(thread.displayTitle).match(UNREAD))).toEqual([]);
  expect(reads(slot)).toHaveLength(6);
  await settled(host);
  expect(host.markReadPeak).toBe(6);
  expect(reads(slot)).toEqual([...roots, ...children].map((thread) => thread.id).sort());
  expect(slot.rpcCalls.filter((call) => call.method === "markSeen")).toEqual([
    expect.objectContaining({ input: { threadIds: ["k1", "k2"] } }),
  ]);
});

it("asks first above 20 threads, and cancelling sends nothing and changes nothing", async () => {
  const many = Array.from({ length: 21 }, (_, n) => unread(`m${n}`));
  const { slot } = await open(many);
  fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Mark 21 threads read?")).toBeTruthy();
  expect(within(dialog).getByText("Every unread thread in the list, child threads included, will be marked read.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(reads(slot)).toEqual([]);
  expect(slot.rpcCalls.some((call) => call.method === "markSeen")).toBe(false);
  expect(many.every((thread) => UNREAD.test(rowLabel(thread.displayTitle)))).toBe(true);
});

it("shows a thread whose read fails unread again, silently from Mark all read", async () => {
  const { host } = await open([unread("u1"), unread("u2")], { failRead: (id) => id === "u2" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  });
  expect(rowLabel("U2")).not.toMatch(UNREAD);
  await settled(host);
  expect(rowLabel("U2")).toMatch(UNREAD);
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  expect(toast.error).not.toHaveBeenCalled();
});

it("shows one Couldn't mark read toast per failed thread from Mark read on a tree, each shown unread again", async () => {
  const { host } = await open(
    [makeThread({ id: "r", title: "Root" }), unread("c", { parentThreadId: "r", createdAt: T0 + 1 }), unread("d", { parentThreadId: "r", createdAt: T0 + 2 }), unread("e", { parentThreadId: "r", createdAt: T0 + 3 })],
    { failRead: (id) => id !== "c" },
  );
  const row = screen.getByRole("link", { name: /Open Root/ }).parentElement!;
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "Mark read" }));
  });
  expect(unreadBelow()).toBeNull();
  await settled(host);
  expect(toast.error.mock.calls.map(([message]) => message)).toEqual(["Couldn't mark read", "Couldn't mark read"]);
  expect(unreadBelow()).not.toBeNull();
});

it("shows a thread unread once bb says a new turn finished while its read was pending", async () => {
  const { host } = await open([unread("u1"), unread("u2")], { markReadMs: 400 });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  });
  expect(rowLabel("U1")).not.toMatch(UNREAD);
  await act(async () => {
    host.updateThread("u1", { latestAttentionAt: T0 + 5_000 });
  });
  await waitFor(() => expect(rowLabel("U1")).toMatch(UNREAD));
  expect(rowLabel("U2")).not.toMatch(UNREAD);
});

it("sends no queued read for a thread marked unread meanwhile, and shows it unread", async () => {
  const threads = Array.from({ length: 8 }, (_, n) => unread(`m${n}`));
  const { host, slot } = await open(threads, { markReadMs: 200 });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  });
  // Two of the eight wait for a slot; mark one of them unread.
  const queued = threads.find((thread) => !reads(slot).includes(thread.id))!;
  const row = screen.getByRole("link", { name: new RegExp(`Open ${queued.displayTitle}\\b`) }).parentElement!;
  fireEvent.pointerDown(within(row).getByRole("button", { name: "Thread actions" }), { button: 0, pointerType: "mouse" });
  const item = await screen.findByRole("menuitem", { name: "Mark unread" });
  await act(async () => {
    fireEvent.click(item);
  });
  expect(rowLabel(queued.displayTitle)).toMatch(UNREAD);
  await settled(host);
  expect(reads(slot)).not.toContain(queued.id);
  expect(reads(slot)).toHaveLength(7);
});
