// When a row's hover card opens: after the pointer really moves over the
// row, or when a key moved focus onto it. Rows sliding under a still
// pointer, focus put back after navigation, and the row you just left
// open nothing.
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";

const OPEN_DELAY = 500;
/** Keys that move focus, so the focus they bring may show a card. */
const FOCUS_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/** The last input was a key that moves focus: `:focus-visible`, as far as the card is concerned. */
let keyed = false;
/** Bumped by every press and every navigation; an open scheduled before a bump never happens. */
let epoch = 0;
let listeners = 0;

function onKeyDown(event: KeyboardEvent) {
  keyed = FOCUS_KEYS.has(event.key);
}

function onPress() {
  keyed = false;
  epoch += 1;
}

/** Drops every pending card open, for a navigation. */
export function cancelPendingCards(): void {
  epoch += 1;
}

export interface RowCard {
  open: boolean;
  /** For the HoverCard: it may close the card, never open it. */
  onOpenChange: (open: boolean) => void;
  rowProps: {
    onPointerEnter: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerLeave: () => void;
    onPointerDown: () => void;
    onFocus: (event: FocusEvent) => void;
    onBlur: () => void;
  };
}

/** The card state for one row. Off for the active row and while `enabled` is false. */
export function useRowCard(isActive: boolean, enabled: boolean): RowCard {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the pointer entered: a move must leave this spot.
  const entry = useRef<{ x: number; y: number } | null>(null);
  // A press holds the card shut until the pointer leaves the row.
  const pressed = useRef(false);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = () => {
    if (timer.current !== null || !enabled || pressed.current) return;
    const at = epoch;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (epoch === at) setOpen(true);
    }, OPEN_DELAY);
  };

  useEffect(() => {
    if (listeners++ === 0) {
      // Keys pressed while no row listened say nothing about the next focus.
      keyed = false;
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", onPress, true);
    }
    return () => {
      cancel();
      if (--listeners === 0) {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerdown", onPress, true);
      }
    };
  }, []);

  // Becoming or ceasing to be the open thread, or a menu or rename taking
  // the row, closes the card and drops a pending open.
  useEffect(() => {
    cancel();
    setOpen(false);
  }, [isActive, enabled]);

  return {
    open: open && enabled && !isActive,
    onOpenChange: (next) => {
      if (next) return;
      cancel();
      setOpen(false);
    },
    rowProps: {
      onPointerEnter: (event) => {
        entry.current = { x: event.clientX, y: event.clientY };
      },
      onPointerMove: (event) => {
        if (event.pointerType === "touch") return;
        const from = entry.current;
        if (from !== null && from.x === event.clientX && from.y === event.clientY) return;
        entry.current = null;
        schedule();
      },
      onPointerLeave: () => {
        cancel();
        entry.current = null;
        pressed.current = false;
      },
      onPointerDown: () => {
        pressed.current = true;
        cancel();
        setOpen(false);
      },
      onFocus: () => {
        // One key, one focus: focus moved by code afterwards opens nothing.
        if (!keyed) return;
        keyed = false;
        schedule();
      },
      onBlur: cancel,
    },
  };
}
