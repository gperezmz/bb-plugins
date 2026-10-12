// Whether the window is phone-width, as bb's own pages decide it.
import { useSyncExternalStore } from "react";

export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

function subscribe(notify: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const list = window.matchMedia(COMPACT_VIEWPORT_QUERY);
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
}

const snapshot = (): boolean => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;

export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
