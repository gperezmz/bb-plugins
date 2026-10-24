// The slide of rows that a reorder moves aside: each row keeps its place on
// screen and eases to its new one over 150 ms. Rows are known by their
// thread id (`data-row-id`), the plugin's own row identity, so nothing else is
// needed to follow a row from one position to the next. Places are read from
// layout (`offsetTop`), so a slide still running does not shift them.
import { rowPlaces, slideDelta, SLIDE_MS, type DrawnItem, type RowPlace } from "../../model/reorder";

/** The list's headers and rows, top to bottom, with their tops from the list's top; a row names its header in `data-row-header`. */
function* drawnItemsOf(container: HTMLElement): Generator<DrawnItem> {
  for (const element of container.children) {
    if (!(element instanceof HTMLElement)) continue;
    const { shelf, groupKey, rowId, rowHeader } = element.dataset;
    if (shelf !== undefined) yield { kind: "header", key: `shelf:${shelf}`, top: element.offsetTop };
    else if (groupKey !== undefined) yield { kind: "header", key: groupKey, top: element.offsetTop };
    else if (rowId !== undefined) yield { kind: "row", id: rowId, header: rowHeader ?? "", top: element.offsetTop };
  }
}

/** The place of each row of `container`, by row id; scrolling does not change them. */
export function readRowPlaces(container: HTMLElement): Map<string, RowPlace> {
  return rowPlaces(drawnItemsOf(container));
}

/** Eases every row that moved from `before` further than its header carried it; none under reduced motion. */
export function slideRows(container: HTMLElement, before: ReadonlyMap<string, RowPlace>, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const now = readRowPlaces(container);
  for (const element of container.querySelectorAll<HTMLElement>(":scope > [data-row-id]")) {
    const was = before.get(element.dataset.rowId!);
    const place = now.get(element.dataset.rowId!);
    if (was === undefined || place === undefined || typeof element.animate !== "function") continue;
    const delta = slideDelta(was, place);
    if (delta === 0) continue;
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: SLIDE_MS, easing: "ease-out" });
  }
}
