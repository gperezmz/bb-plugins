// The text of a caught value, for log lines and refusals.

/** The message of an `Error`, else the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
