// What the rename editor's focus guard decides, apart from the events that ask.

const DIALOG = '[role="dialog"], [role="alertdialog"]';

/** A key press that leaves the editor: Tab, unless held with a modifier that is the system switching windows or tabs. */
export function leavesByKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
}

/** The dialogs open now: a closing menu's drawer is one, and is no dialog opened on its own. */
export function openDialogs(): ReadonlySet<Element> {
  return new Set(document.querySelectorAll(DIALOG));
}

/** Focus inside a dialog that was not in `before`, which the editor leaves where it is. */
export function isHeldByDialog(target: EventTarget | null, before: ReadonlySet<Element>): boolean {
  const dialog = target instanceof Element ? target.closest(DIALOG) : null;
  return dialog !== null && !before.has(dialog);
}

/** Focus that went into a frame: the user pressed in it, where the page sees no pointer press. */
export function isInFrame(target: EventTarget | null): boolean {
  return target instanceof HTMLIFrameElement;
}
