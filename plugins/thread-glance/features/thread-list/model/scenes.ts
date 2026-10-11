// The Working scene's lines, and which one is drawn. Pure.

/** The lines the typist can come with: eighteen. */
export const WORKING_LINES: readonly string[] = [
  "Your agents are typing. Hands off the keyboard.",
  "Everything is in motion. You may stretch.",
  "Tabs are being opened somewhere far away.",
  "The threads are busy. Pour yourself a drink.",
  "Work is happening. Nothing needs you.",
  "Plenty going on, none of it yours.",
  "Somewhere a test is going green.",
  "The keys are clacking. Enjoy the quiet.",
  "Every thread is at work. Look out the window.",
  "Compiling thoughts. Please stand by.",
  "The agents have it. Take five.",
  "Busy, busy, busy. And not you.",
  "Diffs are being drawn. Sit back.",
  "The queue is moving. Go for a walk.",
  "All hands on deck, and none are yours.",
  "Progress is being made without you.",
  "The typing is steady. So is your calm.",
  "Hard at work. Soft at heart.",
];

/**
 * The index of the line to draw. `random` is a number in [0, 1); the line is
 * never the one drawn last (`previous`, or null before the first draw).
 */
export function pickLine(previous: number | null, random: number): number {
  const count = WORKING_LINES.length;
  if (previous === null) return Math.min(count - 1, Math.floor(random * count));
  const index = Math.min(count - 2, Math.floor(random * (count - 1)));
  return index >= previous ? index + 1 : index;
}

/** The text of the All clear scene. */
export const ALL_CLEAR_TEXT = "All clear. Time to touch some grass.";
