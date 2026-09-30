// The settings popover's open state and the dismissal rules it needs beyond
// Radix's own. bb focuses its composer on its own for about a second after a
// page loads, which Radix took for the user leaving the popover; and Radix
// returns focus to the button with a scroll to it.
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether focus moving outside the open popover closes it: after a key was
 * pressed while it was open, or into a frame, whose clicks the page never
 * sees. Any other move is bb's own, and leaves it open.
 */
export function focusOutsideCloses(keyPressed: boolean, target: EventTarget | null): boolean {
  return keyPressed || (target instanceof Element && target.tagName === "IFRAME");
}

/** What the popover's content is given. */
interface ContentProps {
  onFocusOutside(event: Event): void;
  onInteractOutside(event: Event): void;
  onCloseAutoFocus(event: Event): void;
}

/**
 * Holds the settings popover's open state. It closes once `button` is
 * scrolled wholly out of view while `following` is true, as the popover form
 * follows its button and the phone's drawer does not. Closing returns focus to
 * the button without scrolling to it, unless the user pressed or focused
 * something outside.
 */
export function useSettingsPopover(button: RefObject<HTMLButtonElement | null>, following: boolean) {
  const [open, setOpen] = useState(false);
  const keyPressed = useRef(false);
  const leftOutside = useRef(false);

  useEffect(() => {
    if (!open) return;
    keyPressed.current = false;
    const onKey = () => (keyPressed.current = true);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    const target = button.current;
    if (!open || !following || target === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) setOpen(false);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, following, button]);

  const contentProps: ContentProps = {
    onFocusOutside: (event) => {
      if (!focusOutsideCloses(keyPressed.current, event.target)) event.preventDefault();
    },
    onInteractOutside: (event) => {
      if (!event.defaultPrevented && !button.current?.contains(event.target as Node)) leftOutside.current = true;
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      if (!leftOutside.current) button.current?.focus({ preventScroll: true });
      leftOutside.current = false;
    },
  };
  return { open, onOpenChange: setOpen, contentProps };
}
