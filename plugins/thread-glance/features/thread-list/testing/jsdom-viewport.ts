// jsdom lays nothing out, so the list's view is the window's height from the
// top of the page. Every jsdom test gets one tall enough that each list it
// draws is in view whole, and mounts every row as a list with no windowing
// would: the view, not the test, decides what is mounted. Set once for every
// jsdom test (the vitest setup file); nothing else sets it.
export const JSDOM_VIEWPORT_HEIGHT = 1_000_000;

if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: JSDOM_VIEWPORT_HEIGHT });
}
