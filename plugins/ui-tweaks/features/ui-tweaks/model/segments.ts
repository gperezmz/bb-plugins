// Moving the choice in a segmented control from the keyboard.

const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The segment an arrow key moves the choice to, wrapping at either end, or
 * null for any other key. With nothing chosen yet it counts from the first.
 */
export function steppedSegment(key: string, chosen: number, count: number): number | null {
  const step = STEPS[key];
  if (step === undefined) return null;
  return (Math.max(chosen, 0) + step + count) % count;
}
