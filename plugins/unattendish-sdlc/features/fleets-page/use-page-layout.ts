// The Fleets page's layout, from the page's own width as bb draws it beside its sidebar, not the window's.
import { useLayoutEffect, useState, type RefObject } from "react";
import { pageLayout, type PageLayout } from "./model";

/** The size of a rem, in px, as the page draws it. */
function remPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * The layout for the element `page` holds, kept to its width as it is resized; wide until the element is first
 * measured, and where the browser cannot watch an element's size.
 */
export function usePageLayout(page: RefObject<HTMLElement | null>): PageLayout {
  const [layout, setLayout] = useState<PageLayout>("wide");
  useLayoutEffect(() => {
    const element = page.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    // A ResizeObserver reports an element as soon as it is watched, before the browser paints it.
    const watch = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) return;
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setLayout(pageLayout(width, remPx()));
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, [page]);
  return layout;
}
