// @vitest-environment jsdom
// The thread menu's lifecycle commands refuse a gated action on a thread with a
// question waiting below it, from the threads bb lists when the command runs.
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childNeedsYouRefusal } from "@/shared/messages";
import { makeThread } from "@/testing/fixtures";
import { useLifecycleCommands } from "./use-lifecycle-commands";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({ ...(await importOriginal<object>()), useRpc: () => rpc }));

afterEach(() => {
  rpc.call.mockClear();
  toasts.error.mockClear();
});

const family = (grandchild: Partial<Parameters<typeof makeThread>[0]>) => [
  makeThread({ id: "root", title: "Root" }),
  makeThread({ id: "kid", title: "Kid", parentThreadId: "root" }),
  makeThread({ id: "grandkid", title: "Grandkid", parentThreadId: "kid", ...grandchild }),
];

describe("useLifecycleCommands", () => {
  it("refuses Park, Snooze and Settle on a thread with a grandchild asking, naming it, and calls no one", async () => {
    const { result } = renderHook(() => useLifecycleCommands(family({ hasPendingInteraction: true })));
    await result.current.park("root");
    await result.current.snooze("root", Date.now() + 3_600_000);
    await result.current.settle("root");
    expect(toasts.error.mock.calls.map((call) => call[0])).toEqual([
      childNeedsYouRefusal("park", "Grandkid"),
      childNeedsYouRefusal("snooze", "Grandkid"),
      childNeedsYouRefusal("settle", "Grandkid"),
    ]);
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("reads the threads as they are when the command runs, and ignores an archived or hidden asker", async () => {
    rpc.call.mockResolvedValue({ changes: [], note: null, reclaim: {} });
    const asking = family({ hasPendingInteraction: true });
    const { result, rerender } = renderHook(({ threads }) => useLifecycleCommands(threads), { initialProps: { threads: asking } });
    for (const quiet of [{ isHidden: true }, { isArchived: true, archivedAt: Date.now() }]) {
      rerender({ threads: family({ hasPendingInteraction: true, ...quiet }) });
      await result.current.park("root");
    }
    expect(toasts.error).not.toHaveBeenCalled();
    expect(rpc.call.mock.calls).toEqual([
      ["park", { threadId: "root" }],
      ["park", { threadId: "root" }],
    ]);
  });
});
