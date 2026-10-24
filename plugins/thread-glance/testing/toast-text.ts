// What a toast says, for a test that checks the words: a toast's body can be a
// React element, with bb's `ThreadTitle` where a thread is named.
import { Children, isValidElement, type ReactNode } from "react";

/**
 * The text of a toast body, the way it reads on screen: each `ThreadTitle`
 * (any element carrying a `threadId`) is replaced by that thread's title from
 * `titles`, which bb draws from the thread it lists.
 */
export function toastText(body: ReactNode, titles: Readonly<Record<string, string>>): string {
  return Children.toArray(body)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (!isValidElement<{ threadId?: string; children?: ReactNode }>(child)) return "";
      const { threadId, children } = child.props;
      if (threadId !== undefined) return titles[threadId] ?? "";
      return toastText(children, titles);
    })
    .join("");
}
