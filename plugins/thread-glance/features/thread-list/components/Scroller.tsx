// A scroll area with no scrollbar whose edges fade by up to 12 px: as far
// from the top as it has scrolled, and as far from the bottom as is left.
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The fade at an edge never exceeds this many px. */
export const FADE_PX = 12;

/** The fade at the top and bottom edge of a scroll area. Pure. */
export function fadeOf(scrollTop: number, scrollHeight: number, clientHeight: number): { top: number; bottom: number } {
  const left = Math.max(0, scrollHeight - clientHeight - scrollTop);
  return { top: Math.min(FADE_PX, Math.max(0, scrollTop)), bottom: Math.min(FADE_PX, left) };
}

export function Scroller({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = element.current;
    if (scroller === null) return;
    const update = () => {
      const fade = fadeOf(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
      scroller.style.setProperty("--tg-fade-top", `${fade.top}px`);
      scroller.style.setProperty("--tg-fade-bottom", `${fade.bottom}px`);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(scroller);
    if (scroller.firstElementChild !== null) resize?.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, []);
  return (
    <div ref={element} data-scroller={label} className={cn("tg-scroller min-h-0", className)}>
      {children}
    </div>
  );
}
