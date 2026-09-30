// The fake host's counts: plugin RPC calls and bb requests per mount, per
// remount and over 10 idle minutes with one to three windows, `idleAt`
// writes per busy-to-idle transition, and bb's per-row hooks per mounted row.
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { GeneratedList } from "@/features/thread-list/testing/fixtures";
import { markAllReadConfirm } from "./list-screen";
import { createFakeHost, loadWithFakeHost, mountList, mountOverlay, PER_ROW_HOOKS, serverState, type FakeHost } from "./fake-host";

/** Requests over one stretch. */
export interface Requests {
  /** Plugin RPC calls by method. */
  rpc: Record<string, number>;
  /** bb requests: SDK calls and sidebar actions, by name. */
  bb: Record<string, number>;
  rpcTotal: number;
  bbTotal: number;
}

export interface HostFigures {
  firstLoad: Requests;
  /** A remount where bb has no app overlay slot, so the list follows realtime itself. */
  remount: Requests;
  /** A remount beside the plugin's component in bb's app overlay slot, which follows realtime throughout. */
  remountWithOverlay: Requests;
  /** Requests over 10 idle minutes, by the number of windows open. */
  idle: Record<"1" | "2" | "3", Requests>;
  /**
   * Window requests to record `idleAt` (`reportIdle`, or 0.7.0's `markIdle`)
   * when a turn ends, which bb announces, with 3 windows open.
   */
  idleAtWritesPerTransition: number;
  /** Calls to each of bb's per-row hooks per mounted row, over one mount. */
  hooksPerRow: Record<string, number>;
  /** Mark all read on the MAR list; absent on other lists. */
  markAllRead?: MarkAllReadRequests;
}

export interface MarkAllReadRequests {
  markRead: number;
  /** Most `threads.markRead` calls in flight at once. */
  markReadPeak: number;
  markSeen: number;
  counted: number;
}

const tally = (names: string[]) => {
  const out: Record<string, number> = {};
  for (const name of names) out[name] = (out[name] ?? 0) + 1;
  return out;
};

/** Counts the calls windows made after `marks`, the lengths of their logs when the stretch began. */
function since(slots: RenderedSlot[], marks: { rpc: number; sdk: number }[], host: FakeHost, actionMark: number): Requests {
  const rpc = slots.flatMap((slot, index) => slot.rpcCalls.slice(marks[index]!.rpc).map((call) => call.method));
  const sdk = slots.flatMap((slot, index) => slot.sdkCalls.slice(marks[index]!.sdk).map((call) => call.method));
  const actions = host.actionCalls.slice(actionMark).map((call) => `actions.${call.method}`);
  return { rpc: tally(rpc), bb: tally([...sdk, ...actions]), rpcTotal: rpc.length, bbTotal: sdk.length + actions.length };
}

const markOf = (slots: RenderedSlot[]) => slots.map((slot) => ({ rpc: slot.rpcCalls.length, sdk: slot.sdkCalls.length }));

/** Lets queued work land under fully faked timers. */
async function drain(ms = 50): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms / 5);
    });
  }
}

async function windows(list: GeneratedList, count: number, server = serverState()) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
  vi.setSystemTime(list.now);
  const host = createFakeHost({ threads: list.threads, projects: list.projects, freshActions: true });
  const app = await loadWithFakeHost();
  // A page just loaded: its realtime socket connects after the list mounts, as bb's does.
  const slots = Array.from({ length: count }, () => mountList(app, server, undefined, "connecting"));
  await connect(slots);
  return { host, app, server, slots };
}

/** Lets the list's first work land, then brings each page's realtime socket up. */
async function connect(slots: RenderedSlot[]): Promise<void> {
  await drain();
  for (const slot of slots) await slot.behavior.setRealtimeConnectionState("connected");
  await drain();
}

/**
 * The plugin server with every unread child thread of `list` finished since
 * it was read: done-unseen, so Mark all read also marks them seen.
 */
function withDoneUnseen(list: GeneratedList) {
  const finishedAt: Record<string, number> = {};
  const unread = new Set(list.unreadIds);
  for (const thread of list.threads) {
    if (thread.parentThreadId !== null && thread.status === "idle" && unread.has(thread.id)) {
      finishedAt[thread.id] = thread.latestAttentionAt;
    }
  }
  return serverState({}, { stamps: { finishedAt } });
}

export async function runHost(list: GeneratedList, { markAllRead = false } = {}): Promise<HostFigures> {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  localStorage.clear();

  // First load and remount, in one window.
  const first = await windows(list, 1, markAllRead ? withDoneUnseen(list) : serverState());
  const firstLoad = since(first.slots, [{ rpc: 0, sdk: 0 }], first.host, 0);
  const mountedRows = first.slots[0]!.container.querySelectorAll("[data-sidebar-thread-id]").length;
  const hooksPerRow = Object.fromEntries(
    PER_ROW_HOOKS.map((name) => [name, Number((first.host.hookCalls[name] / Math.max(mountedRows, 1)).toFixed(2))]),
  );
  first.slots[0]!.unmount();
  const actionMark = first.host.actionCalls.length;
  const again = mountList(first.app, first.server);
  await drain();
  const remount = since([again], [{ rpc: 0, sdk: 0 }], first.host, actionMark);

  let marked: MarkAllReadRequests | undefined;
  if (markAllRead) {
    first.host.resetCounts();
    const rpcMark = again.rpcCalls.length;
    const sdkMark = again.sdkCalls.length;
    await act(async () => {
      again.getByRole("button", { name: "Mark all read" }).click();
    });
    await drain();
    const confirm = markAllReadConfirm(again);
    await act(async () => {
      confirm.click();
    });
    await drain(200);
    const markRead = again.sdkCalls.slice(sdkMark).filter((call) => call.method === "threads.markRead").length;
    marked = {
      markRead,
      markReadPeak: first.host.markReadPeak,
      markSeen: again.rpcCalls.slice(rpcMark).filter((call) => call.method === "markSeen").length,
      counted: list.unreadIds.length,
    };
  }
  again.unmount();
  vi.useRealTimers();

  // The same, with the plugin's keeper in bb's app overlay slot.
  localStorage.clear();
  const overlaid = await windows(list, 0);
  const overlay = mountOverlay(overlaid.app, overlaid.server, "connecting");
  const listed = mountList(overlaid.app, overlaid.server, undefined, "connecting");
  await connect([overlay, listed]);
  listed.unmount();
  const overlayMark = markOf([overlay]);
  const overlayActions = overlaid.host.actionCalls.length;
  const remounted = mountList(overlaid.app, overlaid.server);
  await drain();
  const remountWithOverlay = since([overlay, remounted], [...overlayMark, { rpc: 0, sdk: 0 }], overlaid.host, overlayActions);
  remounted.unmount();
  overlay.unmount();
  vi.useRealTimers();

  // Ten idle minutes with one, two and three windows.
  const idle = {} as HostFigures["idle"];
  for (const count of [1, 2, 3] as const) {
    localStorage.clear();
    const open = await windows(list, count);
    const marks = markOf(open.slots);
    const actions = open.host.actionCalls.length;
    for (let minute = 0; minute < 10; minute += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    idle[String(count) as "1" | "2" | "3"] = since(open.slots, marks, open.host, actions);
    for (const slot of open.slots) slot.unmount();
    vi.useRealTimers();
  }

  // One thread going busy to idle, seen by three windows.
  localStorage.clear();
  const three = await windows(list, 3);
  const threadId = list.threads[0]!.id;
  three.host.updateThread(threadId, { status: "active", runtimeStatus: "active" });
  await drain();
  const before = markOf(three.slots);
  await act(async () => {
    three.host.updateThread(threadId, { status: "idle", runtimeStatus: "idle", updatedAt: Date.now() });
  });
  await drain(200);
  const idleRequests = since(three.slots, before, three.host, three.host.actionCalls.length).rpc;
  const writes = (idleRequests.reportIdle ?? 0) + (idleRequests.markIdle ?? 0);
  for (const slot of three.slots) slot.unmount();
  vi.useRealTimers();

  return {
    firstLoad,
    remount,
    remountWithOverlay,
    idle,
    idleAtWritesPerTransition: writes,
    hooksPerRow,
    ...(marked ? { markAllRead: marked } : {}),
  };
}
