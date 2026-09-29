// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeThread, working } from "../testing/fixtures";
import { useIdleSince } from "./useIdleSince";

/** Web Locks for one browser: the first request holds the lock until it releases. */
function fakeLocks() {
  const queue: { grant: () => void; signal?: AbortSignal }[] = [];
  let held = false;
  const next = () => {
    while (!held && queue.length > 0) {
      const waiter = queue.shift()!;
      if (waiter.signal?.aborted) continue;
      held = true;
      waiter.grant();
    }
  };
  return {
    request(_name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        queue.push({
          signal: options.signal,
          grant: () =>
            void callback().then(() => {
              held = false;
              resolve();
              next();
            }),
        });
        next();
      });
    },
  };
}

function openWindow(threads: readonly PluginSidebarThread[]) {
  const reportIdle = vi.fn();
  const hook = renderHook(({ list }) => useIdleSince(list, reportIdle), { initialProps: { list: threads } });
  return { reportIdle, show: (list: readonly PluginSidebarThread[]) => hook.rerender({ list }), close: hook.unmount };
}

const idle = makeThread({ id: "p" });
const background = makeThread({ id: "p", activity: { backgroundCommands: 1 } });
const queued = makeThread({ id: "p", queuedWork: "waiting" });
const busy = makeThread({ id: "p", ...working });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reporting a change to idle that bb sends no event for", () => {
  it("is sent by one window of the browser, for background work or a queued message ending", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: fakeLocks() });
    const first = openWindow([background]);
    const second = openWindow([background]);
    await act(async () => {});
    first.show([idle]);
    second.show([idle]);
    expect(first.reportIdle).toHaveBeenCalledExactlyOnceWith(["p"]);
    expect(second.reportIdle).not.toHaveBeenCalled();

    first.show([queued]);
    first.show([idle]);
    expect(first.reportIdle).toHaveBeenCalledTimes(2);
  });

  it("is not sent when a turn ends, which bb's own event records", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: fakeLocks() });
    const only = openWindow([busy]);
    await act(async () => {});
    only.show([idle]);
    expect(only.reportIdle).not.toHaveBeenCalled();
  });

  it("passes to another window once the reporting one closes", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: fakeLocks() });
    const first = openWindow([background]);
    const second = openWindow([background]);
    await act(async () => {});
    first.close();
    await act(async () => {});
    second.show([idle]);
    expect(second.reportIdle).toHaveBeenCalledExactlyOnceWith(["p"]);
  });

  it("is sent by every window where the browser has no Web Locks", () => {
    vi.stubGlobal("navigator", { ...navigator, locks: undefined });
    const windows = [openWindow([background]), openWindow([background])];
    for (const window of windows) window.show([idle]);
    for (const window of windows) expect(window.reportIdle).toHaveBeenCalledExactlyOnceWith(["p"]);
  });
});
