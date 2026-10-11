// A request to open the "Snooze until" dialog for a thread. One per window,
// outside any list: a card's clock menu and bb's thread menu ask, and the one
// dialog the app mounts answers.
import { createDialogRequests } from "@/lib/dialog-requests";

const picker = createDialogRequests<string>();

/** Opens the "Snooze until" dialog for `threadId`; says so when no dialog is mounted. */
export const requestSnoozePicker = picker.request;

/** Calls `listener` with the thread id of every request while the caller is mounted. */
export const useSnoozePickerRequests = picker.useListener;
