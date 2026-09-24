// The text of a thread's failed note. `thread.failed` often carries
// `error: null`; the provider's message is in the thread's `provider/error`
// event, and `turn.failed` carries a structured `errorInfo`.
import type { BbPluginApi, PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import { noteText } from "./notes";

type ErrorInfo = NonNullable<PluginTurnFailedEvent["errorInfo"]>;

/** Rows read from the end of the event log; the failing turn's error is near it. */
const EVENT_TAIL_LIMIT = 20;
const GENERIC_ERRORS = new Set(["error", "failed", "provider error", "turn failed", "unknown error"]);

/** Whether an error string says nothing beyond "it failed". */
export function isGenericError(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return true;
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/, "");
  // bb's own "Command thread.start failed" names the step, not the cause.
  return normalized === "" || GENERIC_ERRORS.has(normalized) || /^command [\w./:-]+ failed$/.test(normalized);
}

/** A short label for an error category, or null when it says nothing. */
export function errorInfoLabel(info: ErrorInfo | null | undefined): string | null {
  if (!info) return null;
  const status = info.httpStatusCode === null ? "" : ` (${info.httpStatusCode})`;
  switch (info.category) {
    case "rate-limit":
      return `Rate limited${status}`;
    case "unauthorized":
      return "Not signed in";
    case "billing":
    case "budget-exceeded":
      return "Out of credits";
    case "context-window-exceeded":
      return "Context window full";
    case "unknown":
      return status === "" ? null : `Error${status}`;
    default: {
      const words = info.category.replace(/-/g, " ");
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}${status}`;
    }
  }
}

/** The fields of a `provider/error` event the note reads. */
export interface ProviderErrorData {
  message?: string;
  detail?: string;
  errorInfo?: ErrorInfo;
}

/** An event row as read here: newest first, `provider/error` and `turn/started` only. */
export interface TailRow {
  type: string;
  scope?: { kind: string; turnId?: string };
  data?: unknown;
}

/**
 * The newest `provider/error` of the failing turn, from rows newest first.
 *
 * With a `turnId`, only an error scoped to that turn counts. Without one,
 * the search stops at the newest `turn/started`, so an error from an earlier
 * turn is not reported for this failure.
 */
export function latestProviderError(
  rows: readonly TailRow[],
  turnId: string | null,
): ProviderErrorData | null {
  for (const row of rows) {
    if (row.type === "turn/started" && turnId === null) return null;
    if (row.type !== "provider/error" && row.type !== "system/error") continue;
    // A system error (a provider that never started) belongs to no turn.
    if (turnId !== null && row.scope?.turnId !== undefined && row.scope.turnId !== turnId) continue;
    return (row.data ?? {}) as ProviderErrorData;
  }
  return null;
}

/**
 * The failure text from what is known, most specific first: a non-generic
 * `error`, the provider error's `detail`, then its `message`, then a label
 * from `errorInfo`. Null when none says more than "it failed".
 */
export function failureText(input: {
  error: string | null;
  providerError: ProviderErrorData | null;
  errorInfo: ErrorInfo | null;
}): string | null {
  const candidates = [
    input.error,
    input.providerError?.detail,
    input.providerError?.message,
    errorInfoLabel(input.errorInfo ?? input.providerError?.errorInfo),
  ];
  for (const candidate of candidates) {
    if (!isGenericError(candidate)) {
      const text = noteText(candidate as string);
      if (text !== "") return text;
    }
  }
  return null;
}

/**
 * Resolves a failure's text, reading the tail of the thread's event log when
 * `error` is generic. A failed read is logged and treated as no event.
 */
export async function resolveFailureText(
  bb: Pick<BbPluginApi, "sdk" | "log">,
  failure: {
    threadId: string;
    error: string | null;
    errorInfo: ErrorInfo | null;
    turnId: string | null;
  },
): Promise<string | null> {
  let providerError: ProviderErrorData | null = null;
  if (isGenericError(failure.error)) {
    try {
      const rows = await bb.sdk.threads.events.list({
        threadId: failure.threadId,
        types: ["provider/error", "system/error", "turn/started"],
        order: "desc",
        limit: String(EVENT_TAIL_LIMIT),
      });
      providerError = latestProviderError(rows as readonly TailRow[], failure.turnId);
    } catch (error) {
      bb.log.warn(
        `could not read events of ${failure.threadId} for its failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failureText({ error: failure.error, providerError, errorInfo: failure.errorInfo });
}
