// The list's view: the part of its scroll area inside the window's viewport,
// in px from the top of the list's first group. A closed phone drawer, moved
// off-canvas or with no height, has an empty view. The tracker re-reads it
// when the scroll area scrolls or resizes, when its intersection with the
// viewport changes (a drawer opening), and when asked after a render.
import type { View } from "../../model/windowing";

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The view of a list whose first group starts at `listTop` (client px),
 * scrolled in `scroller` (its client box; null for the page) inside a
 * `viewport` of the given size. Pure.
 */
function viewOf(scroller: Box | null, listTop: number, viewport: { width: number; height: number }): View {
  const area = scroller ?? { top: 0, bottom: viewport.height, left: 0, right: viewport.width };
  const top = Math.max(area.top, 0);
  const bottom = Math.min(area.bottom, viewport.height);
  const across = Math.min(area.right, viewport.width) - Math.max(area.left, 0);
  if (bottom <= top || across <= 0) return { top: area.top - listTop, height: 0 };
  return { top: top - listTop, height: bottom - top };
}

/** The nearest ancestor that scrolls vertically, or null for the page. */
export function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) return null;
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}

/** Follows one list's view and reports it whenever it changes. */
export class ViewTracker {
  view: View = { top: 0, height: 0 };
  private listeners = new Set<(view: View) => void>();
  private stop: (() => void) | null = null;

  constructor(
    private readonly list: HTMLElement,
    readonly scroller: HTMLElement | null,
  ) {}

  /** Reads the view afresh, telling listeners when it moved. */
  update = (): void => {
    const box = this.scroller?.getBoundingClientRect() ?? null;
    const next = viewOf(box, this.list.getBoundingClientRect().top, {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    });
    if (next.top === this.view.top && next.height === this.view.height) return;
    this.view = next;
    for (const listener of this.listeners) listener(next);
  };

  /** Scrolls the view by `delta` px. */
  scrollBy(delta: number): void {
    if (delta === 0) return;
    if (this.scroller === null) window.scrollBy(0, delta);
    else this.scroller.scrollTop += delta;
  }

  subscribe(listener: (view: View) => void): () => void {
    this.listeners.add(listener);
    if (this.stop === null) this.start();
    listener(this.view);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.dispose();
    };
  }

  private start(): void {
    const target: EventTarget = this.scroller ?? window;
    const update = this.update;
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (this.scroller !== null) resize?.observe(this.scroller);
    // A drawer sliding in changes neither size nor scroll: only its
    // intersection with the viewport.
    const intersection =
      typeof IntersectionObserver === "undefined" || this.scroller === null
        ? null
        : new IntersectionObserver(update, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    if (this.scroller !== null) intersection?.observe(this.scroller);
    this.stop = () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      resize?.disconnect();
      intersection?.disconnect();
    };
    this.update();
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
  }
}
