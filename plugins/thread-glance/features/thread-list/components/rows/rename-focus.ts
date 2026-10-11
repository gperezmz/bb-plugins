// What the rename editor's focus guard decides, apart from the events that ask.

/** A key press that leaves the editor: Tab, unless held with a modifier that is the system switching windows or tabs. */
export function leavesByKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
}

/** A dialog that opened on its own holds focus; the editor does not fight it. */
export function isHeldByDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}
