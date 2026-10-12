// jsdom has no layout, so a test says whether the window is phone-width, and can change it while a page is shown.
import { act } from "@testing-library/react";

let compactNow = false;
const listeners = new Set<() => void>();

/** Makes `matchMedia` answer that the window matches the compact query (or does not), and tells whoever listens. */
export function setCompactViewport(compact: boolean): void {
  compactNow = compact;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return compactNow;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  });
  act(() => {
    for (const listener of [...listeners]) listener();
  });
}
