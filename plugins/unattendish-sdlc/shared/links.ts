// Where a row's Link goes, decided apart from how it is drawn.
import type { LinkView } from "@/src/fleet/application/views";

export type LinkTarget =
  | { readonly kind: "url"; readonly url: string; readonly text: string }
  | { readonly kind: "thread"; readonly threadId: string; readonly text: string };

/** A link to the item or pull request, or one that opens the bb thread whose message the row points at (the manager's own for `this thread`). */
export function linkTarget(link: LinkView, managerThreadId: string): LinkTarget {
  if (link.kind === "url") return { kind: "url", url: link.url, text: link.text };
  const { threadId, message } = link.message;
  return { kind: "thread", threadId: threadId ?? managerThreadId, text: `message ${message}` };
}
