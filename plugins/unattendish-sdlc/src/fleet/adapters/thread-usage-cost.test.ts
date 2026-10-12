// What Fleet reads of Thread Usage's answer, pinned against a fixture shaped like a real `ThreadReport`.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { threadReport } from "../../../test/fixtures/thread-report";
import { THREAD_USAGE_PLUGIN_ID, ThreadUsageCost } from "./thread-usage-cost";

interface Call {
  pluginId: string;
  method: string;
  input?: unknown;
}

const reader = (answer: () => unknown | Promise<unknown>) => {
  const calls: Call[] = [];
  const host = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    sdk: {
      plugins: {
        callRpc: async (args: Call) => {
          calls.push({ pluginId: args.pluginId, method: args.method, input: args.input });
          return answer();
        },
      },
    },
  });
  return { cost: new ThreadUsageCost(host.bb.sdk), calls, host };
};

describe("ThreadUsageCost (AC14)", () => {
  it("asks Thread Usage's report for the thread", async () => {
    const { cost, calls } = reader(() => threadReport({ gateway: 0, harness: 0, estimate: 1 }));
    await cost.costOf("thr_manager");
    expect(calls).toEqual([{ pluginId: THREAD_USAGE_PLUGIN_ID, method: "report", input: { threadId: "thr_manager" } }]);
  });

  it("adds up the gateway, harness and estimate sources of the tree total, in the report's currency", async () => {
    const { cost } = reader(() => threadReport({ gateway: 1.25, harness: 0.5, estimate: 0.125 }, { currency: "EUR" }));
    expect(await cost.costOf("thr_manager")).toEqual({ amount: 1.875, currency: "EUR" });
  });

  it("reads a tree with nothing spent as zero", async () => {
    const { cost } = reader(() => threadReport({ gateway: 0, harness: 0, estimate: 0 }));
    expect(await cost.costOf("thr_manager")).toEqual({ amount: 0, currency: "USD" });
  });

  it.each([
    ["a call that fails (Thread Usage not installed)", () => Promise.reject(new Error("plugin thread-usage is not installed"))],
    ["an answer that is not an object", () => "nothing"],
    ["a missing tree total", () => ({ currency: "USD" })],
    ["a tree total without the cost sources", () => threadReport({ gateway: 0, harness: 0, estimate: 0 }, { treeTotal: { figure: {} } })],
    ["a cost source renamed", () => ({ ...threadReport({ gateway: 1, harness: 1, estimate: 1 }), treeTotal: { figure: { cost: { gateway: 1, harness: 1, projected: 1 } } } })],
    ["a cost source that is not a number", () => ({ ...threadReport({ gateway: 1, harness: 1, estimate: 1 }), treeTotal: { figure: { cost: { gateway: "1", harness: 1, estimate: 1 } } } })],
    ["a negative cost", () => threadReport({ gateway: -1, harness: 0, estimate: 0 })],
    ["a currency that is missing", () => threadReport({ gateway: 1, harness: 0, estimate: 0 }, { currency: undefined })],
    ["a cost that is not finite", () => threadReport({ gateway: Number.POSITIVE_INFINITY, harness: 0, estimate: 0 })],
  ])("hides the cost, with no error, for %s", async (_name, answer) => {
    const { cost, host } = reader(answer);
    await expect(cost.costOf("thr_manager")).resolves.toBeNull();
    expect(host.harness.logEntries).toEqual([]);
  });

  it("reads a report that carries more than the cost, as the real one does", async () => {
    const { cost } = reader(() => ({ ...threadReport({ gateway: 0, harness: 0, estimate: 2 }), somethingNew: { nested: true } }));
    expect(await cost.costOf("thr_manager")).toEqual({ amount: 2, currency: "USD" });
  });
});
