// When the action composer sends, cancels or does nothing.

/** Nothing sends while the text is empty. */
export function canSend(text: string): boolean {
  return text.trim() !== "";
}

export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/** ⌘/Ctrl+Enter sends (ignored while empty), Esc cancels, any other key is the text area's own. */
export function keyIntent(event: KeyLike, text: string): "send" | "cancel" | null {
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSend(text)) return "send";
  return null;
}
