/**
 * The context bar's arithmetic: where a size sits on a bar from 0 to the
 * context window, and which of the ten settings a drag or a typed size lands
 * on. The handle moves only between settings that have a line.
 */
import { parseSize, snapSetting } from "@/src/core/line";

/** Where `tokens` sits on the bar, 0–1. */
export function fractionOf(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.min(1, Math.max(0, tokens / window));
}

/** The setting nearest a point on the bar. */
export function settingAt(fraction: number, lines: readonly (number | null)[], window: number): number {
  return snapSetting(Math.min(1, Math.max(0, fraction)) * window, lines);
}

/** The setting one step from `current` that has a line, or `current` at either end. */
export function stepSetting(current: number, step: 1 | -1, lines: readonly (number | null)[]): number {
  for (let n = current + step; n >= 1 && n <= lines.length; n += step) {
    if (lines[n - 1] !== null) return n;
  }
  return current;
}

/** The setting a typed size snaps to, or null when the text is not a size. */
export function settingForText(text: string, lines: readonly (number | null)[]): number | null {
  const size = parseSize(text);
  return size === null ? null : snapSetting(size, lines);
}

/** "$1.24", or "<$0.01" for under a cent. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** How a page entry's cost fell between threads, largest first: "Parent $0.03, Build the page $0.02". Null with nothing to split. */
export function splitText(split: Record<string, number> | undefined, titleOf: (threadId: string) => string): string | null {
  const parts = Object.entries(split ?? {}).sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return null;
  return parts.map(([id, usd]) => `${titleOf(id)} ${formatUsd(usd)}`).join(", ");
}

/**
 * A page entry's cost as the page shows it: a keep-warm or check-in whose
 * turn could not be measured shows its forecast, marked `≈`. A compaction's
 * estimate is not marked; the page's footnote says compactions are estimated.
 */
export function costText(usd: number | null, estimated: boolean | undefined, kind: string): { text: string; estimate: boolean } {
  if (usd === null) return { text: "–", estimate: false };
  const estimate = kind !== "compaction" && estimated === true;
  return { text: estimate ? `≈${formatUsd(usd)}` : formatUsd(usd), estimate };
}
