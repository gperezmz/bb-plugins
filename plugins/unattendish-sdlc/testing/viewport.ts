// jsdom has no layout, so a test says whether the window is phone-width.

/** Makes `matchMedia` answer that the window matches the compact query (or does not). */
export function setCompactViewport(compact: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: compact,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}
