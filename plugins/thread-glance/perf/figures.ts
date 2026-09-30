// Every figure one run of the harness takes, keyed by where it was taken.
import type { MarkAllReadFigure, JsdomFigures } from "./harness/jsdom-run";
import type { HostFigures, MarkAllReadRequests } from "./harness/host-run";
import type { ServerFigures } from "./harness/server-run";
import type { ChromiumFigures, MarkAllReadTiming } from "./harness/chromium-figures";

export const SIZES = [50, 300, 1_500] as const;
export const SCENARIOS = ["live", "settled"] as const;
export type Size = (typeof SIZES)[number];
export type Scenario = (typeof SCENARIOS)[number];
/** A generated list: its size and scenario, as `1500/live`. */
export type Cell = `${Size}/${Scenario}`;

export const CELLS: Cell[] = SIZES.flatMap((size) => SCENARIOS.map((scenario) => `${size}/${scenario}` as Cell));

export interface BundleFigures {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface Figures {
  jsdom: Partial<Record<Cell, JsdomFigures>>;
  host: Partial<Record<Cell, HostFigures>>;
  chromium: Partial<Record<Cell, ChromiumFigures>>;
  /** The Mark all read list's own run. */
  markAllRead: { jsdom?: MarkAllReadFigure; host?: MarkAllReadRequests; chromium?: MarkAllReadTiming };
  server?: ServerFigures;
  bundle?: BundleFigures;
  /** A real list passed with PERF_THREADS, outside the ledger. */
  snapshot?: JsdomFigures;
}

export function emptyFigures(): Figures {
  return { jsdom: {}, host: {}, chromium: {}, markAllRead: {} };
}

/** Merges runs that each took some of the figures. */
export function mergeFigures(parts: readonly Partial<Figures>[]): Figures {
  const merged = emptyFigures();
  for (const part of parts) {
    Object.assign(merged.jsdom, part.jsdom);
    Object.assign(merged.host, part.host);
    Object.assign(merged.chromium, part.chromium);
    Object.assign(merged.markAllRead, part.markAllRead);
    if (part.server) merged.server = part.server;
    if (part.bundle) merged.bundle = part.bundle;
    if (part.snapshot) merged.snapshot = part.snapshot;
  }
  return merged;
}
