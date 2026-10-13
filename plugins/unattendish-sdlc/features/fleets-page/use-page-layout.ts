// The Fleets page's layout, from the page's own width as bb draws it beside its sidebar, not the window's.
import { useLayoutEffect, useState, type RefObject } from "react";
import { pageLayout, widthWithScrollbar, type PageLayout } from "./model";

/** The size of a rem, in px, as the page draws it. */
function remPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** The nearest ancestor of `element` that scrolls it up and down; null where the window does. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/** The width of the scrollbar `scroller` draws now: 0 while it has nothing to scroll, or draws its scrollbar over the page. */
function gutterNow(scroller: HTMLElement): number {
  const style = getComputedStyle(scroller);
  const borders = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth) || 0;
  return Math.max(0, scroller.offsetWidth - scroller.clientWidth - borders);
}

/** The width of the scrollbar `scroller` draws while it scrolls, which it is made to draw for a moment where it has none. */
function gutterScrolling(scroller: HTMLElement): number {
  const now = gutterNow(scroller);
  if (now > 0) return now;
  // Set back before the browser draws again, so nothing shows it, and no size the observer reports changes.
  const inline = scroller.style.overflowY;
  scroller.style.overflowY = "scroll";
  const full = gutterNow(scroller);
  scroller.style.overflowY = inline;
  return full;
}

/**
 * The layout for the element `page` holds, kept to its width as it is resized; wide where the browser cannot watch an
 * element's size. The width counted is the page's with a scrollbar drawn, so the layout's own height, which can bring
 * or take away the scrollbar, never switches it back.
 */
export function usePageLayout(page: RefObject<HTMLElement | null>): PageLayout {
  const [layout, setLayout] = useState<PageLayout>("wide");
  useLayoutEffect(() => {
    const element = page.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    // Where the window scrolls the page, its scrollbar is counted as it is.
    const scroller = scrollerOf(element);
    const gutter = scroller === null ? 0 : gutterScrolling(scroller);
    const choose = (width: number) => setLayout(pageLayout(scroller === null ? width : widthWithScrollbar(width, gutterNow(scroller), gutter), remPx()));
    // Measured once before the browser paints, so a narrow page never shows the wide layout first.
    choose(element.getBoundingClientRect().width);
    const watch = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      choose(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, [page]);
  return layout;
}
