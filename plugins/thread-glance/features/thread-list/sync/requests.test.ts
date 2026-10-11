// A `sync` that fails is asked again while a keeper follows realtime, so the
// signals held for the first answer don't pile up for good.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parkedRow } from "@/shared/lifecycle";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { endPluginLifetime } from "./lifetime";
import { pluginData } from "./plugin-data";
import { requestSync } from "./requests";

const answer = {
  epoch: "e1",
  revision: 1,
  full: true,
  records: { a: { lifecycle: parkedRow(5) } },
  settings: { epoch: "e1", version: 1, value: DEFAULT_SETTINGS },
  order: { epoch: "e1", version: 1, value: [] },
  appearance: { epoch: "e1", version: 1, value: { colours: {}, icons: {} } },
};

/** An rpc client whose `sync` fails `failures` times, then answers. */
function rpcFailing(failures: number) {
  let left = failures;
  const call = vi.fn(async () => {
    if (left-- > 0) throw new Error("offline");
    return answer;
  });
  return { call } as unknown as Parameters<typeof requestSync>[0] & { call: typeof call };
}

beforeEach(() => {
  vi.useFakeTimers();
  endPluginLifetime();
});
afterEach(() => {
  endPluginLifetime();
  vi.useRealTimers();
});

describe("a failed sync", () => {
  it("is asked again with a growing wait while a keeper follows, and the buffered signals land", async () => {
    pluginData.follow();
    const rpc = rpcFailing(2);
    await requestSync(rpc, "current");
    expect(pluginData.get().status).toBe("failed");
    pluginData.signal({ epoch: "e1", revision: 2, records: { b: { lifecycle: parkedRow(7) } } });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc.call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(rpc.call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc.call).toHaveBeenCalledTimes(3);

    expect(pluginData.get().status).toBe("current");
    expect(Object.keys(pluginData.get().records.lifecycle).sort()).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rpc.call).toHaveBeenCalledTimes(3);
  });

  it("is not asked again once no keeper follows", async () => {
    const stop = pluginData.follow();
    const rpc = rpcFailing(5);
    await requestSync(rpc, "current");
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
});
