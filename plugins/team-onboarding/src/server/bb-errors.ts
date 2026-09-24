// Errors the bb server answers with, as the SDK throws them.
import { redactSecrets } from "../core/redact.js";

/**
 * An error the bb server answered with (the SDK's `BbHttpError`): its
 * status, code and message, masked and bounded for the page.
 */
export function bbRefusal(error: unknown): { status: number; code: string | null; text: string } | null {
  if (!(error instanceof Error) || error.name !== "BbHttpError") return null;
  const { status, code } = error as Error & { status?: unknown; code?: unknown };
  if (typeof status !== "number") return null;
  const safeCode = typeof code === "string" && /^[\w.-]{1,64}$/.test(code) ? code : null;
  const message = redactSecrets(error.message).replace(/\s+/g, " ").trim().slice(0, 200);
  const text = `bb answered ${status}${safeCode === null ? "" : ` ${safeCode}`}${message === "" ? "" : ` (${message})`}.`;
  return { status, code: safeCode, text };
}
