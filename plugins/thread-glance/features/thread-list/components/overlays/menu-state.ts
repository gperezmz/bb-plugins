// What the list's menu hosts share: the menu of their kinds that is open, kept
// while it closes, and a rename chosen in a menu, started once it has closed.
import { useEffect, useRef } from "react";
import type { OpenMenu } from "../../store/api";
import { useOpenMenu } from "../../store/hooks";

/** How long a closing menu's focus return may take before a rename starts anyway. */
const RENAME_AFTER_CLOSE_MS = 60;
/** How long after Rename is chosen the closing menu's focus return is refused. */
const FOCUS_RETURN_WINDOW_MS = 1500;

/**
 * Starts a rename chosen in a menu once the menu has closed: at its focus
 * return, which it refuses, or shortly after it closes where no focus return
 * comes (a phone's drawer, a context menu opened from the keyboard).
 */
export function useRenameAfterClose(open: boolean) {
  const pending = useRef<(() => void) | null>(null);
  const refuseFocus = useRef(false);
  useEffect(() => {
    if (open || pending.current === null) return;
    const timer = setTimeout(() => {
      const start = pending.current;
      pending.current = null;
      start?.();
    }, RENAME_AFTER_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return {
    /** Remembers the rename to start once the menu has closed. */
    request(start: () => void) {
      pending.current = start;
      refuseFocus.current = true;
      setTimeout(() => {
        refuseFocus.current = false;
      }, FOCUS_RETURN_WINDOW_MS);
    },
    onCloseAutoFocus(event: Event) {
      if (!refuseFocus.current) return;
      refuseFocus.current = false;
      event.preventDefault();
      const start = pending.current;
      pending.current = null;
      start?.();
    },
  };
}

/** The last menu of `kinds` opened, kept while it closes so its content stays for the exit. */
export function useShownMenu<K extends OpenMenu["kind"]>(kinds: readonly K[]): { open: boolean; shown: Extract<OpenMenu, { kind: K }> | null } {
  const menu = useOpenMenu();
  const last = useRef<Extract<OpenMenu, { kind: K }> | null>(null);
  const open = menu !== null && (kinds as readonly string[]).includes(menu.kind);
  if (open) last.current = menu as Extract<OpenMenu, { kind: K }>;
  return { open, shown: last.current };
}
