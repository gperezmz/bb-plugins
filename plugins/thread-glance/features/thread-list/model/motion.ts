// Whether the person asked bb for less motion. Read when a command or an
// animation starts; components that draw it follow `useMediaQuery` instead.

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
