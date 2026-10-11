// jsdom lays nothing out. This gives the list's rows boxes in document order,
// 100 px tall each, and lets `elementFromPoint` find them, so a pointer drag
// can be driven against the real components.
const ROW_HEIGHT = 100;
const SELECTOR = "[data-row-id],[data-group-key]";

function units(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SELECTOR)];
}

function rectOf(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

/** Installs the boxes; returns the call that removes them. */
export function installRowBoxes(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  const elementFromPoint = document.elementFromPoint;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const all = units();
    const index = all.indexOf(this as HTMLElement);
    return index >= 0 ? rectOf(index * ROW_HEIGHT, ROW_HEIGHT) : original.call(this);
  };
  document.elementFromPoint = (_x: number, y: number) => units().find((_element, index) => y >= index * ROW_HEIGHT && y < (index + 1) * ROW_HEIGHT) ?? null;
  return () => {
    Element.prototype.getBoundingClientRect = original;
    document.elementFromPoint = elementFromPoint;
  };
}

/** The y of the middle of the row at `index` (document order among rows and group headers). */
export function rowY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}
