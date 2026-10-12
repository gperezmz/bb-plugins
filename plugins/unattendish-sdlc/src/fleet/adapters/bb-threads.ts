// The Fleet context's two needs from bb's threads: whether a manager is still
// there, and a way to send it a wake that waits behind its turn.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { DeliveryResult, ManagerChannel, ThreadDirectory } from "../application/ports";

type BbSdk = BbPluginApi["sdk"];

/** The HTTP status bb's SDK reported for a failed call, from the error's `status` or its `HTTP <status>` message; null when it carried none. */
export const httpStatusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status;
  const match = /\bHTTP (\d{3})\b/.exec(error instanceof Error ? error.message : String(error));
  return match === null ? null : Number(match[1]);
};

/** All a failed call may say: its status, never bb's message, which can quote the text sent. */
const reasonOf = (error: unknown): string => {
  const status = httpStatusOf(error);
  return status === null ? "no answer from bb" : `HTTP ${status}`;
};

/** Reads a thread's standing from bb: live, archived, or gone (deleted, or no such thread). */
export class BbThreadDirectory implements ThreadDirectory {
  constructor(private readonly sdk: BbSdk) {}

  async state(threadId: string): Promise<"live" | "archived" | "gone"> {
    let thread: { archivedAt: number | null; deletedAt: number | null };
    try {
      thread = await this.sdk.threads.get({ threadId });
    } catch (error) {
      if (httpStatusOf(error) === 404) return "gone";
      throw error;
    }
    if (thread.deletedAt !== null) return "gone";
    return thread.archivedAt !== null ? "archived" : "live";
  }
}

/** Sends a wake to a manager thread as the plugin's own message, queued behind a running turn. */
export class BbManagerChannel implements ManagerChannel {
  constructor(
    private readonly sdk: BbSdk,
    private readonly pluginId: string,
  ) {}

  async send(threadId: string, text: string): Promise<DeliveryResult> {
    try {
      const answer = await this.sdk.threads.send({
        threadId,
        input: [{ type: "text", text, mentions: [] }],
        mode: "queue-if-active",
        pluginSubmission: { pluginId: this.pluginId, data: {} },
      });
      return answer.delivery === "sent" ? { delivered: "sent" } : { delivered: "queued", queuedMessageId: answer.queuedMessage.id };
    } catch (error) {
      return { delivered: "refused", reason: reasonOf(error) };
    }
  }

  /**
   * Replaces the text of a queued wake in place. bb refuses an update whose
   * `expectedUpdatedAt` is stale (409); that is retried once against the
   * freshly listed row, and a row that is no longer there, or that bb will no
   * longer let be edited, is `gone`. The row is not held for edit: that lease
   * is for a person typing in the queue, and `expectedUpdatedAt` already
   * guards the one write.
   */
  async amend(threadId: string, queuedMessageId: string, text: string): Promise<"amended" | "gone" | { readonly refused: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let row: { id: string; updatedAt: number; editable: boolean } | undefined;
      try {
        row = (await this.sdk.threads.queuedMessages.list({ threadId })).find((queued) => queued.id === queuedMessageId);
      } catch (error) {
        return httpStatusOf(error) === 404 ? "gone" : { refused: reasonOf(error) };
      }
      if (row === undefined || !row.editable) return "gone";
      try {
        await this.sdk.threads.queuedMessages.update({
          threadId,
          queuedMessageId,
          expectedUpdatedAt: row.updatedAt,
          input: [{ type: "text", text, mentions: [] }],
        });
        return "amended";
      } catch (error) {
        const status = httpStatusOf(error);
        if (status === 404) return "gone";
        if (status !== 409) return { refused: reasonOf(error) };
      }
    }
    return "gone";
  }
}
