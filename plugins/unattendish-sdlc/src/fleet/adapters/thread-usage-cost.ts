// The cost of a manager's thread tree, asked of Thread Usage through bb's
// plugin-to-plugin RPC. Thread Usage is a plugin of this repository with no
// published contract, so only the part of its `report` answer read here is
// described, and an answer that does not match it hides the cost.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CostReader } from "../application/ports";

type BbSdk = BbPluginApi["sdk"];

export const THREAD_USAGE_PLUGIN_ID = "thread-usage";

const amount = z.number().finite().nonnegative();

/**
 * What Fleet reads of Thread Usage's `report` answer (`ThreadReport`): its currency, and the three cost sources of
 * the thread tree's total (`treeTotal.figure.cost`), which Thread Usage adds up to the headline total.
 */
export const REPORT_COST = z.object({
  currency: z.string().min(1).max(16),
  treeTotal: z.object({ figure: z.object({ cost: z.object({ gateway: amount, harness: amount, estimate: amount }) }) }),
});

/** How long Thread Usage may take to answer. */
export const REPORT_TIMEOUT_MS = 10_000;

export class ThreadUsageCost implements CostReader {
  constructor(private readonly sdk: BbSdk) {}

  /** Null, with no error and nothing logged, when Thread Usage is not installed, fails, or answers in another shape. */
  async costOf(threadId: string): Promise<{ readonly amount: number; readonly currency: string } | null> {
    try {
      const answer = await this.sdk.plugins.callRpc({
        pluginId: THREAD_USAGE_PLUGIN_ID,
        method: "report",
        input: { threadId },
        outputSchema: REPORT_COST,
        signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
      });
      const report = REPORT_COST.safeParse(answer);
      if (!report.success) return null;
      const { gateway, harness, estimate } = report.data.treeTotal.figure.cost;
      return { amount: gateway + harness + estimate, currency: report.data.currency };
    } catch {
      return null;
    }
  }
}
