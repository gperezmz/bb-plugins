// What the Chromium run reports, per generated list.
import type { ScriptAttribution } from "./cpu-profile";

/** Interaction to Next Paint for one interaction, at 1× and 4× CPU slowdown, in ms. */
export interface InpFigure {
  x1: number | null;
  x4: number | null;
}

export interface ChromiumFigures {
  /** The React build the run timed. */
  build: "production" | "development";
  inp: {
    group: InpFigure;
    childrenChip: InpFigure;
    /** Null where nothing is settled, so there is no Settled fold to open. */
    settledFold: InpFigure | null;
  };
  mountToFirstRowMs: number;
  remountToFirstRowMs: number;
  /** Time to mount and draw the rows that 100 rows of scrolling bring into view. */
  scrollMountMs: number;
  rowsMounted: number;
  /**
   * Mounted rows against the rows the view extended 240 px above and below
   * holds, over each check (after mount, after the scroll, after a group, a
   * children chip and the Settled fold open and close).
   */
  window: { checks: number; excess: number; missing: number };
  /** Across 10 unmount and mount cycles, each read after a forced garbage collection. */
  cycles: {
    heapGrowthBytes: number;
    intersectionObservers: number[];
    resizeObservers: number[];
    detachedNodes: number[];
  };
  /** The plugin's JavaScript time per realtime event, in ms. */
  eventJsMs: Record<string, number>;
  /** At 390×844: rows mounted with the drawer closed, and frame times scrolling it open. */
  phone: { rowsMountedClosed: number; rowHeightPx: number; openFrameMaxMs: number; openFrameP95Ms: number };
  /**
   * A drag held at the list's bottom edge and then its top edge: how far each
   * scrolled the list, whether the dragged row stayed mounted, and whether the
   * drop nested the thread under a row that was not mounted when it began.
   */
  dragFar?: {
    scrolledDownPx: number;
    scrolledUpPx: number;
    draggedStayed: boolean;
    targetId: string | null;
    targetWasMounted: boolean;
    nested: boolean;
  };
}

export interface MarkAllReadTiming {
  inp: InpFigure;
  /** Script time from the click to the last `threads.markRead` answer, at 1×, by whose it was. */
  script: ScriptAttribution;
}
