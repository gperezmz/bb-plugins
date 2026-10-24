// "Notify parent": which of a child thread's turn outcomes wake its parent. bb
// keeps the choice per thread as `parentNotifications`; Thread Glance stores
// nothing for it. Pure.

/** bb's values: every outcome, only the ones that need the parent, or none. */
export type ParentNotifications = "auto" | "stuck" | "off";

export interface NotifyChoice {
  id: ParentNotifications;
  label: string;
}

export const NOTIFY_CHOICES: readonly NotifyChoice[] = [
  { id: "auto", label: "All outcomes" },
  { id: "stuck", label: "Only when stuck" },
  { id: "off", label: "Off" },
];

export function isParentNotifications(value: unknown): value is ParentNotifications {
  return NOTIFY_CHOICES.some((choice) => choice.id === value);
}

/** What the menu reads of a thread to decide whether to offer Notify parent. */
export interface NotifyThread {
  parentThreadId: string | null;
  originKind: "fork" | null;
}

/** Whether Notify parent is offered: bb reports a child's outcomes to its parent, never a fork's. */
export function canNotifyParent(thread: NotifyThread): boolean {
  return thread.parentThreadId !== null && thread.originKind !== "fork";
}

/** The window's knowledge of bb's setting, and the way to change it. */
export interface NotifyState {
  /** The setting for each thread read so far; a thread not yet read, or whose read failed, has none. */
  values: ReadonlyMap<string, ParentNotifications>;
  /** Sets bb's setting for a thread; resolves once bb has taken it, and tells the person when it has not. */
  set(threadId: string, value: ParentNotifications): Promise<void>;
}
