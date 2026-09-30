// Every figure one run of the harness takes, keyed by where it was taken.
import type { MarkAllReadFigure, JsdomFigures } from "./harness/jsdom-run";
import type { HostFigures, MarkAllReadRequests } from "./harness/host-run";
import type { ServerFigures } from "./harness/server-run";
import type { ChromiumFigures, MarkAllReadTiming } from "./harness/chromium-figures";
import type { GeneratedListKind } from "@/features/thread-list/testing/fixtures";

export const SIZES = [50, 300, 1_500] as const;
export const LIST_KINDS: readonly GeneratedListKind[] = ["live", "settled"];
export type Size = (typeof SIZES)[number];
export type ListKind = GeneratedListKind;
/** A generated list: its size and kind, as `1500/live`. */
export type Cell = `${Size}/${ListKind}`;

export const CELLS: Cell[] = SIZES.flatMap((size) => LIST_KINDS.map((kind) => `${size}/${kind}` as Cell));

/** A cell's size and kind, as `generateList` takes them. */
export function parseCell(cell: Cell): { size: Size; kind: ListKind } {
  const [size, kind] = cell.split("/");
  return { size: Number(size) as Size, kind: kind as ListKind };
}

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
