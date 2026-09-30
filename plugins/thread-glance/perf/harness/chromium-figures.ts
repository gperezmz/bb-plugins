// What the Chromium run reports, per generated list.

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
    chip: InpFigure;
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
}

export interface MarkAllReadTiming {
  inp: InpFigure;
  /** Main-thread time from the click to the last `setRead` answer, in ms. */
  mainThreadMs: number;
}
