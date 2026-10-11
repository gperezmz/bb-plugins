/** The text to show for a failure: its message, or `fallback` when it has none. */
export function messageOf(error: unknown, fallback = "Something went wrong."): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return text !== "" ? text : fallback;
}
