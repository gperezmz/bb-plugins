// The fake host's counts: plugin RPC calls and bb requests per mount, per
// remount and over 10 idle minutes with one to three windows, `idleAt`
// writes per busy-to-idle transition, and bb's per-row hooks per mounted row.
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { GeneratedList } from "@/features/thread-list/testing/fixtures";
import { createFakeHost, loadWithFakeHost, mountList, PER_ROW_HOOKS, serverState, type FakeHost } from "./fake-host";

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
  remount: Requests;
  /** Requests over 10 idle minutes, by the number of windows open. */
  idle: Record<"1" | "2" | "3", Requests>;
  /** `markIdle` calls (one `idleAt` write each) for one thread going busy to idle, with 3 windows open. */
  idleAtWritesPerTransition: number;
  /** Calls to each of bb's per-row hooks per mounted row, over one mount. */
  hooksPerRow: Record<string, number>;
  /** Mark all read on the MAR list; absent on other lists. */
  markAllRead?: MarkAllReadRequests;
}

export interface MarkAllReadRequests {
  setRead: number;
  /** Most `setRead` calls in flight at once. */
  setReadPeak: number;
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

async function windows(list: GeneratedList, count: number) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
  vi.setSystemTime(list.now);
  const host = createFakeHost({ threads: list.threads, projects: list.projects, freshActions: true });
  const app = await loadWithFakeHost();
  const server = serverState();
  const slots = Array.from({ length: count }, () => mountList(app, server));
  await drain();
  return { host, app, server, slots };
}

export async function runHost(list: GeneratedList, { markAllRead = false } = {}): Promise<HostFigures> {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  localStorage.clear();

  // First load and remount, in one window.
  const first = await windows(list, 1);
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
    await act(async () => {
      again.getByRole("button", { name: "Mark all read" }).click();
    });
    await drain();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
      (button) => button.textContent?.trim() === "Mark all read",
    );
    if (confirm !== undefined) {
      await act(async () => {
        confirm.click();
      });
    }
    await drain(200);
    const setRead = first.host.actionCalls.filter((call) => call.method === "setRead").length;
    marked = {
      setRead,
      setReadPeak: first.host.setReadPeak,
      markSeen: again.rpcCalls.slice(rpcMark).filter((call) => call.method === "markSeen").length,
      counted: list.unreadIds.length,
    };
  }
  again.unmount();
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
  const writes = since(three.slots, before, three.host, three.host.actionCalls.length).rpc.markIdle ?? 0;
  for (const slot of three.slots) slot.unmount();
  vi.useRealTimers();

  return {
    firstLoad,
    remount,
    idle,
    idleAtWritesPerTransition: writes,
    hooksPerRow,
    ...(marked ? { markAllRead: marked } : {}),
  };
}
