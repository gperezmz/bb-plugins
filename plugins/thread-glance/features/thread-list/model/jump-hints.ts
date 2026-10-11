// Jump hints: holding the shortcut modifier (Ctrl, or ⌘ on a Mac) alone for
// 700 ms labels the first nine rows. This is the hold's rule as a state
// machine over key events; the keeper binds it to the window and the DOM.

/** bb's own hold delay, so the hints appear together with the host's. */
export const HOLD_DELAY_MS = 700;

/** How many rows the hints label: bb's jump keys reach the first nine. */
export const JUMP_COUNT = 9;

export function jumpLabel(position: number, mac: boolean): string {
  return mac ? `⌘ ${position}` : `Ctrl + ${position}`;
}

export interface HoldEvents {
  keyDown(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): void;
  keyUp(event: Pick<KeyboardEvent, "key">): void;
  blur(): void;
  dispose(): void;
}

/**
 * Calls `show` after the modifier has been held alone for 700 ms and `hide`
 * when it is released, another key goes down, Shift or Alt joins it, or the
 * window loses focus.
 */
export function trackHold({ mac, show, hide }: { mac: boolean; show(): void; hide(): void }): HoldEvents {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  const isModifier = (key: string) => key === (mac ? "Meta" : "Control");
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!shown) return;
    shown = false;
    hide();
  };
  return {
    keyDown(event) {
      if (!isModifier(event.key)) {
        cancel();
        return;
      }
      if (shown || timer !== undefined) return;
      const other = event.key === "Meta" ? event.ctrlKey : event.metaKey;
      if (event.shiftKey || event.altKey || other) {
        cancel();
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        shown = true;
        show();
      }, HOLD_DELAY_MS);
    },
    keyUp(event) {
      if (isModifier(event.key)) cancel();
    },
    blur: cancel,
    dispose: cancel,
  };
}
