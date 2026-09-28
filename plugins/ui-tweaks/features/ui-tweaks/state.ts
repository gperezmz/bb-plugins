// The window's copy of the saved tweaks: `TweaksSync` fills it from the
// server, and the content script and the settings rows read it. Null until
// the first read answers.
import { sameTweaks, type Tweaks } from "@/shared/tweaks";

type Listener = (tweaks: Tweaks | null) => void;

export interface TweakState {
  get(): Tweaks | null;
  set(tweaks: Tweaks): void;
  /** Calls the listener now and on every change; returns the unsubscribe. */
  subscribe(listener: Listener): () => void;
}

export function createTweakState(): TweakState {
  let current: Tweaks | null = null;
  const listeners = new Set<Listener>();
  return {
    get: () => current,
    set(tweaks) {
      if (current && sameTweaks(current, tweaks)) return;
      current = tweaks;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
  };
}

/** The one copy per window: every part of the plugin's bundle shares it. */
export const tweakState = createTweakState();
