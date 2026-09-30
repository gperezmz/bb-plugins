// Radix positions a menu or card against its trigger's element. The list's
// one host of each has no trigger per row: this stands in for one, handing
// Radix the element the overlay belongs to (a row's "…" button, or the row),
// so the overlay anchors to it, follows it as it scrolls, and returns focus
// to it on close. It draws nothing and takes none of the trigger's handlers.
import { forwardRef, useImperativeHandle } from "react";

export const Anchor = forwardRef<HTMLElement | null, { element: HTMLElement | null }>(function Anchor({ element }, ref) {
  useImperativeHandle(ref, () => element as HTMLElement, [element]);
  return null;
});
