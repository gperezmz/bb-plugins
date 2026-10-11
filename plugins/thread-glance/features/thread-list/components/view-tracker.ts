// The list's view: the part of its area that is on screen, in px from the top
// of the list's first item. The area is clipped by the window and by every
// ancestor that scrolls or clips, so a list inside bb's scroll area and inside
// the plugin's own scroller sees only what shows through both. A closed phone
// drawer, moved off-canvas or with no height, has an empty view. The tracker
// re-reads it when an ancestor scrolls or resizes, when its intersection with
// the viewport changes (a drawer opening), and when asked after a render.
import type { View } from "../model/windowing";

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The part of `list` (client px) that shows through `clips` and the window. Pure. */
export function viewOf(listTop: number, clips: readonly Box[], viewport: { width: number; height: number }): View {
  let top = 0;
  let bottom = viewport.height;
  let left = 0;
  let right = viewport.width;
  for (const clip of clips) {
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
  }
  if (bottom <= top || right - left <= 0) return { top: top - listTop, height: 0 };
  return { top: top - listTop, height: bottom - top };
}

/** The ancestors of `element` that scroll or clip vertically, nearest first. */
export function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay" || overflowY === "hidden" || overflowY === "clip") {
      found.push(node);
    }
  }
  return found;
}

/** Follows one list's view and reports it whenever it changes. */
export class ViewTracker {
  view: View = { top: 0, height: 0 };
  private listeners = new Set<(view: View) => void>();
  private stop: (() => void) | null = null;
  private clips: HTMLElement[] = [];

  constructor(private readonly list: HTMLElement) {}

  /** Reads the view afresh, telling listeners when it moved. */
  update = (): void => {
    const boxes = this.clips.map((clip) => clip.getBoundingClientRect());
    const next = viewOf(this.list.getBoundingClientRect().top, boxes, {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    });
    if (next.top === this.view.top && next.height === this.view.height) return;
    this.view = next;
    for (const listener of this.listeners) listener(next);
  };

  /** Scrolls the nearest scrolling ancestor by `delta` px. */
  scrollBy(delta: number): void {
    if (delta === 0) return;
    const scroller = this.clips[0];
    if (scroller === undefined) window.scrollBy(0, delta);
    else scroller.scrollTop += delta;
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
    this.clips = clippingAncestors(this.list);
    const update = this.update;
    for (const clip of this.clips) clip.addEventListener("scroll", update, { passive: true });
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (const clip of this.clips) resize?.observe(clip);
    // A drawer sliding in changes neither size nor scroll: only its
    // intersection with the viewport.
    const intersection =
      typeof IntersectionObserver === "undefined" || this.clips.length === 0
        ? null
        : new IntersectionObserver(update, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const clip of this.clips) intersection?.observe(clip);
    this.stop = () => {
      for (const clip of this.clips) clip.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
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
