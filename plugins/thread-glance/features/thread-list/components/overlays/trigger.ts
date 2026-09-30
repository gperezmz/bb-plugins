// A "…" button that opens one of the list's menus, as Radix's own trigger
// does: a primary press or Enter, Space or ArrowDown opens it on desktop, a
// tap on phones, where the menu is a drawer. The button is the menu's anchor.
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

export function menuTriggerProps(open: boolean, compact: boolean, onOpen: (anchor: HTMLElement) => void, onClose: () => void) {
  const toggle = (anchor: HTMLElement) => (open ? onClose() : onOpen(anchor));
  return {
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "data-state": open ? "open" : "closed",
    "data-no-drag": "",
    onPointerDown(event: PointerEvent<HTMLElement>) {
      event.stopPropagation();
      if (compact || event.button !== 0 || event.ctrlKey) return;
      toggle(event.currentTarget);
      // Focus goes to the menu, not the button.
      if (!open) event.preventDefault();
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === "Enter" || event.key === " ") toggle(event.currentTarget);
      else if (event.key === "ArrowDown") onOpen(event.currentTarget);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    onClick(event: MouseEvent<HTMLElement>) {
      event.stopPropagation();
      event.preventDefault();
      if (compact) toggle(event.currentTarget);
    },
  };
}
