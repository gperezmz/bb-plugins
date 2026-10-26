// Whether the pointer rests on an element of a card that takes no pointer
// events. A card's lines pass the pointer through to the row link beneath, so
// the link would lose its clicks, drags and hover card if the element took it;
// instead the card's own box listens and tests the pointer against the
// element's.
import { useEffect, useState, type RefObject } from "react";

/** How long the pointer rests on the element before this reports it, as a tooltip waits. */
export const ICON_HOVER_DELAY_MS = 400;

/** Whether a point lies inside a box. */
export function pointInBox(box: { left: number; right: number; top: number; bottom: number }, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * True once the pointer has rested on `target` for `ICON_HOVER_DELAY_MS`,
 * until it moves off or leaves the thread card around it, or until a pointer
 * down, a context menu or Escape dismisses it; a dismissed rest stays closed
 * until the pointer has left `target`. `active` false listens to nothing.
 */
export function useRestingOn(target: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [resting, setResting] = useState(false);
  useEffect(() => {
    const card = target.current?.closest<HTMLElement>("[data-thread-id]");
    if (!active || !card) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      timer = undefined;
      setResting(false);
    };
    // `timer` stays set from the pointer's arrival on the element until `clear`, a dismissed or fired one included, so a dismissal while the pointer is elsewhere is none and a dismissed rest is not started again. None of the listeners stops or cancels its event: the click, the menu and Escape's other handlers still run.
    const dismiss = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      setResting(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onMove = (event: PointerEvent) => {
      const element = target.current;
      if (!element || event.pointerType === "touch" || !pointInBox(element.getBoundingClientRect(), event.clientX, event.clientY)) return clear();
      if (timer === undefined) timer = setTimeout(() => setResting(true), ICON_HOVER_DELAY_MS);
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", clear);
    card.addEventListener("pointerdown", dismiss);
    card.addEventListener("contextmenu", dismiss);
    // Captured, so a handler that stops Escape below the document still lets this see it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", clear);
      card.removeEventListener("pointerdown", dismiss);
      card.removeEventListener("contextmenu", dismiss);
      document.removeEventListener("keydown", onKeyDown, true);
      clear();
    };
  }, [target, active]);
  return resting && active;
}
