/** An error, or whatever was thrown, as text for a person. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
