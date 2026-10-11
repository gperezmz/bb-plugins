// The texts the server refuses with. The app shows them as they arrive, and
// its tests compare against these.

/** What a gated action is called in a refusal. */
export type GatedAction = "snooze" | "park" | "settle";

/** The refusal for a busy thread: it is working or waiting for input. */
export function busyRefusal(action: GatedAction, title: string): string {
  return `Cannot ${action} while ${title} is working or waiting for input`;
}

export const TREE_CHANGED = "Thread tree changed while settling. Try again.";
export const SETTLE_UNDO_GONE = "This Settle can no longer be undone. Use Un-settle instead.";
export const THREAD_GONE = "Thread is no longer available";
export const SNOOZE_ENDED = "This snooze has already ended.";
