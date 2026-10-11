// A request to open the "Snooze until" dialog for a thread. One per window,
// outside any list: a card's clock menu and bb's thread menu ask, and the one
// dialog the app mounts answers.
import { useEffect } from "react";

const listeners = new Set<(threadId: string) => void>();

/** Opens the "Snooze until" dialog for `threadId`, where a dialog is mounted. */
export function requestSnoozePicker(threadId: string): void {
  for (const listener of [...listeners]) listener(threadId);
}

/** Calls `listener` with the thread id of every request while the caller is mounted. */
export function useSnoozePickerRequests(listener: (threadId: string) => void): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}
