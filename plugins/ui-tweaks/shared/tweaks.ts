// The two tweaks, their choices and what each choice means. The server and
// the app both read this module, so it imports nothing.
export const TEXT_SIZES = ["small", "medium", "large"] as const;
export const WIDTHS = ["narrow", "medium", "wide"] as const;

export type TextSize = (typeof TEXT_SIZES)[number];
export type Width = (typeof WIDTHS)[number];

export interface Tweaks {
  textSize: TextSize;
  width: Width;
}

export type TweakKey = keyof Tweaks;

const CHOICES: { [K in TweakKey]: readonly Tweaks[K][] } = { textSize: TEXT_SIZES, width: WIDTHS };

/** The choice a stored or received value names, or undefined when it names none. */
export function parseChoice<K extends TweakKey>(key: K, value: unknown): Tweaks[K] | undefined {
  return (CHOICES[key] as readonly unknown[]).includes(value) ? (value as Tweaks[K]) : undefined;
}

/** Both tweaks from a received value, or null when either is not a choice. */
export function parseTweaks(value: unknown): Tweaks | null {
  const record = (value ?? {}) as Record<string, unknown>;
  const textSize = parseChoice("textSize", record.textSize);
  const width = parseChoice("width", record.width);
  return textSize && width ? { textSize, width } : null;
}

/** Medium is bb's own look, so the defaults change nothing. */
export const DEFAULT_TWEAKS: Tweaks = { textSize: "medium", width: "medium" };

/** bb's own transcript text, 13 px, scales to 12 px and 15 px. */
export const TEXT_SCALE: Record<TextSize, number> = {
  small: 12 / 13,
  medium: 1,
  large: 15 / 13,
};

/** Maximum width in px of the transcript's content column and the composer. */
export const WIDTH_PX: Record<Width, number> = {
  narrow: 640,
  medium: 760,
  wide: 960,
};

/** The realtime channel the server announces a change of either tweak on. */
export const TWEAKS_CHANNEL = "tweaks";
