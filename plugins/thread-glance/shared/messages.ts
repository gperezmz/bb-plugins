// The texts the server refuses with. The app shows them as they arrive, and
// its tests compare against these.

/** What a gated action is called in a refusal. */
export type GatedAction = "snooze" | "park" | "settle";

/** A refusal's text around the thread title it names, so the app can draw the title as bb's chips while the server joins plain text. */
export type RefusalParts = readonly [before: string, after: string];

/** The refusal for a busy thread: it is working or waiting for input. */
export function busyRefusalParts(action: GatedAction): RefusalParts {
  return [`Cannot ${action} while `, " is working or waiting for input"];
}

/** The refusal for a thread with a question or approval waiting below it. */
export function childNeedsYouRefusalParts(action: GatedAction): RefusalParts {
  return [`Cannot ${action} while a child thread needs you: `, ""];
}

export function busyRefusal(action: GatedAction, title: string): string {
  const [before, after] = busyRefusalParts(action);
  return `${before}${title}${after}`;
}

export function childNeedsYouRefusal(action: GatedAction, title: string): string {
  const [before, after] = childNeedsYouRefusalParts(action);
  return `${before}${title}${after}`;
}

export const TREE_CHANGED = "Thread tree changed while settling. Try again.";
export const SETTLE_UNDO_GONE = "This Settle can no longer be undone. Use Un-settle instead.";
export const THREAD_GONE = "Thread is no longer available";
export const SNOOZE_ENDED = "This snooze has already ended.";
