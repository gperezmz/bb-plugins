// bb's theme as the document's class says (`.dark` or `.light`), never the
// system's colour scheme. Components that need to compute a colour for the
// theme (a project's name, nudged to 4.5:1) read it here.
import { useSyncExternalStore } from "react";
import type { ThemeMode } from "../model/project-colour";

function read(): ThemeMode {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

let mode: ThemeMode = read();
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    mode = read();
    observer = new MutationObserver(() => {
      const next = read();
      if (next === mode) return;
      mode = next;
      for (const notify of [...listeners]) notify();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** bb's theme now: `dark` when the document has the `dark` class, else `light`. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    subscribe,
    () => (listeners.size === 0 ? read() : mode),
    () => "light",
  );
}
