// The slide of rows that a reorder moves aside: each row keeps its place on
// screen and eases to its new one over 150 ms. Rows are known by their
// thread id (`data-row-id`), the plugin's own row identity, so nothing else is
// needed to follow a row from one position to the next.
import { SLIDE_MS } from "../../model/reorder";

/** The offsets of the rows from the top of `container`, by row id; scrolling does not change them. */
export function rowOffsets(container: HTMLElement): Map<string, number> {
  const offsets = new Map<string, number>();
  const top = container.getBoundingClientRect().top;
  for (const element of container.querySelectorAll<HTMLElement>("[data-row-id]")) {
    offsets.set(element.dataset.rowId!, element.getBoundingClientRect().top - top);
  }
  return offsets;
}

/** Eases every row that moved from `before` to where it is now; none under reduced motion. */
export function slideRows(container: HTMLElement, before: ReadonlyMap<string, number>, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const top = container.getBoundingClientRect().top;
  for (const element of container.querySelectorAll<HTMLElement>("[data-row-id]")) {
    const was = before.get(element.dataset.rowId!);
    if (was === undefined || typeof element.animate !== "function") continue;
    const delta = was - (element.getBoundingClientRect().top - top);
    if (delta === 0) continue;
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: SLIDE_MS, easing: "ease-out" });
  }
}
