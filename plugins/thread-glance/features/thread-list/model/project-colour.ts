// Project colours: a soft automatic colour per project from its id, the
// hue stepping away from the ones already taken, the contrast nudge that makes
// a project's name readable, and where a stripe shows. Pure.
import type { Settings } from "@/shared/settings";

/** A project's colour as components use it. */
export interface ProjectColour {
  /** The project colour: stripes, and the monogram's tile at 20 %. */
  fill: string;
  /** The colour of the project's name, nudged to 4.5:1 against the theme's background. */
  text: string;
}

/** The theme a name is read against. */
export type ThemeMode = "light" | "dark";

const LIGHT_BACKGROUND = "#f5f5f5";
const DARK_BACKGROUND = "#202020";

/** The background a project name is nudged against in a theme. */
export function themeBackground(theme: ThemeMode): string {
  return theme === "light" ? LIGHT_BACKGROUND : DARK_BACKGROUND;
}

/** The contrast a project name reaches against the theme's background. */
export const NAME_CONTRAST = 4.5;

/** Hues closer than this to a taken colour's are stepped away from. */
const MIN_HUE_GAP = 24;
/** The golden angle: successive steps never land near each other. */
const HUE_STEP = 137.507764;
const MAX_ATTEMPTS = 24;

/** FNV-1a over the id's characters. */
export function hashId(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return hash >>> 0;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColour(value: string): boolean {
  return HEX.test(value);
}

export function hexToRgb(hex: string): Rgb {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return 255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex({ r: channel(0), g: channel(8), b: channel(4) });
}

/** The hue of a `#rrggbb` colour in degrees; 0 for a grey. */
export function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const apart = Math.abs(a - b) % 360;
  return Math.min(apart, 360 - apart);
}

/** The colour of attempt `attempt` for a project: the id's own hue, then golden-angle steps from it. */
export function automaticColour(projectId: string, attempt = 0): string {
  const hash = hashId(projectId);
  const hue = ((hash / 2 ** 32) * 360 + attempt * HUE_STEP) % 360;
  // Saturation 26-37 %, lightness 62-69 %.
  return hslToHex(hue, 0.26 + ((hash >>> 8) % 12) / 100, 0.62 + (hash % 8) / 100);
}

/**
 * Every project's colour: its override, else the automatic one. Projects are
 * taken in id order so a colour does not move when the list is reordered; an
 * automatic hue steps until it is at least 24 degrees from every colour
 * already taken (the overrides first), keeping the farthest if none is.
 */
export function projectColours(projectIds: readonly string[], overrides: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const ids = [...new Set(projectIds)].sort();
  const taken: number[] = [];
  for (const id of ids) {
    const override = overrides[id];
    if (override !== undefined && isHexColour(override)) taken.push(hueOf(override));
  }
  const colours = new Map<string, string>();
  for (const id of ids) {
    const override = overrides[id];
    if (override !== undefined && isHexColour(override)) {
      colours.set(id, override.toLowerCase());
      continue;
    }
    let best = automaticColour(id);
    let bestGap = -1;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = automaticColour(id, attempt);
      const gap = taken.length === 0 ? 360 : Math.min(...taken.map((hue) => hueDistance(hue, hueOf(candidate))));
      if (gap > bestGap) {
        best = candidate;
        bestGap = gap;
      }
      if (gap >= MIN_HUE_GAP) break;
    }
    taken.push(hueOf(best));
    colours.set(id, best);
  }
  return colours;
}

function luminance({ r, g, b }: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

/** The WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `colour` nudged toward white (dark theme) or black (light theme), in 5 %
 * steps, until it reaches 4.5:1 against the theme's background; a colour
 * that already does is returned as it is.
 */
export function readableColour(colour: string, theme: ThemeMode): string {
  const background = themeBackground(theme);
  const target = theme === "dark" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const from = hexToRgb(colour);
  for (let step = 0; step <= 20; step += 1) {
    const mix = step / 20;
    const adjusted = rgbToHex({
      r: from.r + (target.r - from.r) * mix,
      g: from.g + (target.g - from.g) * mix,
      b: from.b + (target.b - from.b) * mix,
    });
    if (contrastRatio(adjusted, background) >= NAME_CONTRAST) return adjusted;
  }
  return rgbToHex(target);
}

/** `colour` as `rgba(...)` at `alpha` (0 to 1), for a monogram's tile. */
export function withAlpha(colour: string, alpha: number): string {
  const { r, g, b } = hexToRgb(colour);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The monogram's tile takes the project colour at this opacity, on every surface. */
export const MONOGRAM_ALPHA = 0.2;

/** Where a stripe can show. */
export type StripeSurface = "full" | "collapsed" | "group";

/**
 * Whether a stripe shows on a surface: Full cards, the one-line cards (folded
 * cards and slim rows) and Project-mode group headers, as Show stripes in says.
 */
export function stripeShown(stripesIn: Settings["stripesIn"], surface: StripeSurface): boolean {
  if (surface === "group") return true;
  if (stripesIn === "grouped") return false;
  return surface === "full" || stripesIn === "full-and-collapsed";
}
