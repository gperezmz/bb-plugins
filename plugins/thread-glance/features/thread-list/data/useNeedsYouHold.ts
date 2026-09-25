// Which family Needs you holds while one of its threads is open. Diffed
// render to render, as auto-expansion is; nothing here is persisted.
import { useRef } from "react";
import type { Forest } from "../model/families";
import { holdNeedsYou } from "../model/needs-you";

export function useNeedsYouHold(forest: Forest | null, activeThreadId: string | null): string | null {
  const held = useRef<string | null>(null);
  const lastForest = useRef<Forest | null>(null);
  const lastActive = useRef<string | null | undefined>(undefined);
  // Derived during render, so the family never leaves for a frame. Idempotent:
  // a repeated render with the same inputs keeps what it stored.
  if (forest !== null && (forest !== lastForest.current || activeThreadId !== lastActive.current)) {
    held.current = holdNeedsYou(held.current, activeThreadId === null ? undefined : forest.familyOf.get(activeThreadId));
    lastForest.current = forest;
    lastActive.current = activeThreadId;
  }
  return held.current;
}
