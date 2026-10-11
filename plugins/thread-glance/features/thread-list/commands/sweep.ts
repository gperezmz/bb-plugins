// The Settle sweep: which cards are on screen, and which of them play the
// 520 ms sweep now. One per window, outside any list, so a Settle chosen from
// the thread header's menu sweeps the card the sidebar draws for that thread.
import { useSyncExternalStore } from "react";

/** The Settle sweep across a card, in ms. */
export const SWEEP_MS = 520;

const drawn = new Map<string, number>();
let sweeping: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function setSweeping(next: ReadonlySet<string>): void {
  sweeping = next;
  for (const listener of [...listeners]) listener();
}

/** A card calls this while it is drawn; returns the call that says it is gone. */
export function registerCard(threadId: string): () => void {
  drawn.set(threadId, (drawn.get(threadId) ?? 0) + 1);
  return () => {
    const left = (drawn.get(threadId) ?? 1) - 1;
    if (left <= 0) drawn.delete(threadId);
    else drawn.set(threadId, left);
  };
}

export function isCardDrawn(threadId: string): boolean {
  return drawn.has(threadId);
}

export function isSweeping(threadId: string): boolean {
  return sweeping.has(threadId);
}

/** Plays the sweep on the thread's card and resolves when it ends. */
export async function playSweep(threadId: string): Promise<void> {
  setSweeping(new Set(sweeping).add(threadId));
  try {
    await new Promise((resolve) => setTimeout(resolve, SWEEP_MS));
  } finally {
    const next = new Set(sweeping);
    next.delete(threadId);
    setSweeping(next);
  }
}

/** Whether the card plays the sweep now. */
export function useIsSweeping(threadId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sweeping.has(threadId),
  );
}
