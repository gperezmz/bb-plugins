// The Fleet context's two needs from bb's threads: whether a manager is still
// there, and a way to send it a wake that waits behind its turn. Every call to bb is bounded
// by `SDK_TIMEOUT_MS`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { redact } from "../domain/redact";
import { clip } from "../domain/text";
import type { DeliveryResult, ManagerChannel, ThreadDirectory, ThreadRepositories, ThreadStanding } from "../application/ports";

type BbSdk = BbPluginApi["sdk"];

/** The HTTP status bb's SDK reported for a failed call, from the error's `status` or its `HTTP <status>` message; null when it carried none. */
export const httpStatusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status;
  const match = /\bHTTP (\d{3})\b/.exec(error instanceof Error ? error.message : String(error));
  return match === null ? null : Number(match[1]);
};

/** The most characters of bb's own message a reason carries. */
export const REASON_MESSAGE_MAX = 160;
/** The text sent, or one of its lines, is replaced where bb quotes it only when it is at least this long, so a short one does not garble the message. */
const QUOTED_LINE_MIN = 4;

/** `text` with every occurrence of each of `quoted` replaced by `…`, the longest first. */
const withoutQuotes = (text: string, quoted: readonly string[]): string =>
  [...quoted].sort((a, b) => b.length - a.length).reduce((rest, quote) => (quote === "" ? rest : rest.split(quote).join("…")), text);

/**
 * Why a call to bb failed, for the ledger's log, the dashboard and the operator: `HTTP <status>: <bb's message>`, or
 * the status alone where bb gave no message, or `no answer from bb` where it gave no status. bb's message is cut to
 * `REASON_MESSAGE_MAX` characters on one line, with the text that was sent (the whole message and each of its
 * lines of four or more characters, as bb may quote them) replaced by `…` and every token the plugin holds scrubbed.
 */
export const reasonOf = (error: unknown, sent: string, secrets: readonly string[]): string => {
  const status = httpStatusOf(error);
  if (status === null) return "no answer from bb";
  const raw = error instanceof Error ? error.message : "";
  const own = raw.replace(/^\s*HTTP \d{3}\b[\s:,-]*/i, "");
  const quoted = [sent, sent.trim(), sent.replace(/\s+/g, " ").trim(), ...sent.split(/\r\n|\r|\n/).map((line) => line.trim())].filter((quote) => quote.length >= QUOTED_LINE_MIN);
  const message = clip(redact(withoutQuotes(own, quoted), secrets).replace(/\s+/g, " ").trim(), REASON_MESSAGE_MAX);
  return message === "" ? `HTTP ${status}` : `HTTP ${status}: ${message}`;
};

/** How long any one call to bb's SDK may take before it is given up on. */
export const SDK_TIMEOUT_MS = 30_000;

/** Runs one SDK call, failing it when bb has not answered within `SDK_TIMEOUT_MS`, so a hung call fails one poll rather than stopping every fleet's. */
const bounded = <T>(call: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bb did not answer within ${SDK_TIMEOUT_MS / 1000} seconds`)), SDK_TIMEOUT_MS);
    call().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });

/** Reads a thread's standing from bb: live (at work or idle), archived, or gone (deleted, or no such thread). */
export class BbThreadDirectory implements ThreadDirectory {
  constructor(private readonly sdk: BbSdk) {}

  async state(threadId: string): Promise<"live" | "archived" | "gone"> {
    return (await this.standing(threadId)).state;
  }

  async standing(threadId: string): Promise<ThreadStanding> {
    let thread: { archivedAt: number | null; deletedAt: number | null; status?: string; updatedAt?: number };
    try {
      thread = await bounded(() => this.sdk.threads.get({ threadId }));
    } catch (error) {
      if (httpStatusOf(error) === 404) return { state: "gone" };
      throw error;
    }
    if (thread.deletedAt !== null) return { state: "gone" };
    if (thread.archivedAt !== null) return { state: "archived" };
    // bb gives the thread's status and when the thread last changed; it keeps no time of the status itself, so that stands for it.
    const busy = typeof thread.status === "string" && thread.status !== "idle" && thread.status !== "error";
    return { state: "live", busy, since: typeof thread.updatedAt === "number" ? new Date(thread.updatedAt).toISOString() : null };
  }
}

/** Reads the git remote of a thread's project from bb. */
export class BbThreadRepositories implements ThreadRepositories {
  constructor(private readonly sdk: BbSdk) {}

  async remoteOf(threadId: string): Promise<string | null> {
    try {
      const thread = await bounded(() => this.sdk.threads.get({ threadId }));
      if (typeof thread.projectId !== "string") return null;
      const project = await bounded(() => this.sdk.projects.get({ projectId: thread.projectId }));
      return typeof project.gitRemoteUrl === "string" && project.gitRemoteUrl !== "" ? project.gitRemoteUrl : null;
    } catch {
      return null;
    }
  }
}

/** Sends a wake to a manager thread as the plugin's own message, queued behind a running turn. */
export class BbManagerChannel implements ManagerChannel {
  constructor(
    private readonly sdk: BbSdk,
    private readonly pluginId: string,
    /** Every token the plugin holds, scrubbed from the reasons it reports. */
    private readonly secrets: () => string[] = () => [],
  ) {}

  async send(threadId: string, text: string): Promise<DeliveryResult> {
    try {
      const answer = await bounded(() =>
        this.sdk.threads.send({
          threadId,
          input: [{ type: "text", text, mentions: [] }],
          mode: "queue-if-active",
          pluginSubmission: { pluginId: this.pluginId, data: {} },
        }),
      );
      return answer.delivery === "sent" ? { delivered: "sent" } : { delivered: "queued", queuedMessageId: answer.queuedMessage.id };
    } catch (error) {
      return { delivered: "refused", reason: reasonOf(error, text, this.secrets()) };
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
        row = (await bounded(() => this.sdk.threads.queuedMessages.list({ threadId }))).find((queued) => queued.id === queuedMessageId);
      } catch (error) {
        return httpStatusOf(error) === 404 ? "gone" : { refused: reasonOf(error, text, this.secrets()) };
      }
      if (row === undefined || !row.editable) return "gone";
      try {
        await bounded(() =>
          this.sdk.threads.queuedMessages.update({
            threadId,
            queuedMessageId,
            expectedUpdatedAt: row.updatedAt,
            input: [{ type: "text", text, mentions: [] }],
          }),
        );
        return "amended";
      } catch (error) {
        const status = httpStatusOf(error);
        if (status === 404) return "gone";
        if (status !== 409) return { refused: reasonOf(error, text, this.secrets()) };
      }
    }
    return "gone";
  }
}
