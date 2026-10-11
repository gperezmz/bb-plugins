// What the list shows instead of threads: loading, an error, the All clear
// scene and the Working scene.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REDUCED_MOTION_QUERY } from "../model/motion";
import { ALL_CLEAR_TEXT, pickLine, WORKING_LINES } from "../model/scenes";

/** The spinner appears only after this long. */
export const LOADING_DELAY_MS = 200;

/** "Loading threads…" with a spinner after 200 ms; its live region is in the page from the start. */
export function LoadingState() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
      {visible ? (
        <>
          <Icon name="Loading" aria-hidden className="size-4 animate-spin" />
          <span>Loading threads…</span>
        </>
      ) : null}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry(): void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-sm">
      <p className="text-muted-foreground">Could not load threads.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

const STROKE = { fill: "none", stroke: "var(--tg-scene-stroke)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** "All clear. Time to touch some grass.", with a small outline of grass and a sun. */
export function AllClearScene() {
  return (
    <div data-scene="all-clear" className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
      <svg aria-hidden viewBox="0 0 96 56" className="h-14 w-24" {...STROKE}>
        <circle cx="74" cy="14" r="7" />
        <path d="M74 2v3M74 23v3M62 14h3M83 14h3M65.5 5.5l2 2M80.5 20.5l2 2M65.5 22.5l2-2M80.5 7.5l2-2" />
        <path d="M6 52h84" />
        <path d="M18 52c0-8-3-12-6-15M18 52c0-6 2-11 6-14M18 52c1-5 5-8 9-9" />
        <path d="M40 52c0-9-3-14-7-18M40 52c0-7 2-13 7-16M40 52c1-5 5-8 10-9" />
        <path d="M60 52c0-6-2-9-5-12M60 52c0-5 2-8 5-10" />
      </svg>
      <p>{ALL_CLEAR_TEXT}</p>
    </div>
  );
}

/** The index drawn last, so the next draw is another line. */
let lastLine: number | null = null;

/** An animated outline typist with one of 18 lines; a new one is drawn on each mount and never the last. */
export function WorkingScene() {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const [index] = useState(() => {
    const next = pickLine(lastLine, Math.random());
    lastLine = next;
    return next;
  });
  return (
    <div data-scene="working" className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
      <svg aria-hidden viewBox="0 0 96 64" className="h-16 w-24" {...STROKE}>
        <path d="M10 56h76" />
        <path d="M28 56V36h40v20" />
        <path d="M34 36V22h28v14" />
        <circle cx="48" cy="14" r="6" />
        <path d="M42 30l-8 10M54 30l8 10" className={cn(!reduced && "tg-typing")} />
        <path d="M30 40h36" />
      </svg>
      <p data-line={index}>{WORKING_LINES[index]}</p>
    </div>
  );
}
