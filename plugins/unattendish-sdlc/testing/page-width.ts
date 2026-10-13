// jsdom has no layout, so a test says how wide every watched element is, and can change it while a page is shown.
import { act } from "@testing-library/react";

let widthNow: number | null = null;
const watchers = new Set<FakeResizeObserver>();

class FakeResizeObserver {
  private readonly watched = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element): void {
    this.watched.add(element);
    watchers.add(this);
    this.report();
  }
  unobserve(element: Element): void {
    this.watched.delete(element);
  }
  disconnect(): void {
    this.watched.clear();
    watchers.delete(this);
  }
  report(): void {
    if (widthNow === null) return;
    const width = widthNow;
    const entries = [...this.watched].map((target) => ({ target, contentRect: { width }, borderBoxSize: [{ inlineSize: width, blockSize: 0 }] }) as unknown as ResizeObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

/**
 * Makes every element a ResizeObserver watches `px` wide, and tells every observer; `null` takes the fake away, as a
 * browser with no ResizeObserver has none.
 */
export function setPageWidth(px: number | null): void {
  widthNow = px;
  if (px === null) {
    watchers.clear();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    return;
  }
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: FakeResizeObserver });
  act(() => {
    for (const watcher of [...watchers]) watcher.report();
  });
}
