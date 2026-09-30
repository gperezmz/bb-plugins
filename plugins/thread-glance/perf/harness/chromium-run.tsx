/// <reference types="vite/client" />
// The Chromium run: the list mounted through the fake host in a sidebar-sized
// scroll area, timed with Event Timing and the Chrome DevTools Protocol
// (forced garbage collection, heap, live observers, detached nodes, script
// time). Runs in vitest browser mode; `deterministicOnly` takes the figures
// that do not depend on timing, for `npm test`.
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import { CHANNELS } from "@/shared/contract";
import type { GeneratedList } from "@/features/thread-list/testing/fixtures";
import { createFakeHost, loadWithFakeHost, mountList, serverState, type FakeHost, type Frame, type ServerState } from "./fake-host";
import type { ChromiumFigures, InpFigure, MarkAllReadTiming } from "./chromium-figures";
import { markAllReadConfirm } from "./list-screen";

type PluginApp = Awaited<ReturnType<typeof loadWithFakeHost>>;

const DESKTOP = { width: 1280, height: 900 };
const SIDEBAR: Frame = { width: 280, height: 860 };
const PHONE = { width: 390, height: 844 };
const OVERSCAN = 240;

/**
 * A real click. Forced, because dnd-kit marks a draggable header or row
 * `aria-disabled`, which Playwright reads as a disabled button.
 */
const click = (target: Element) => userEvent.click(target, { force: true });

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the frame after the current one has been drawn. */
async function drawn(): Promise<void> {
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function until(test: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = performance.now();
  while (!test()) {
    if (performance.now() - started > timeoutMs) throw new Error("timed out waiting for the list");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function anchors(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]")];
}

function frameOf(slot: RenderedSlot): HTMLElement {
  return slot.container.querySelector<HTMLElement>("[data-perf-frame]")!;
}

// ——— The DevTools protocol, through the step's own browser commands ———

interface PerfCommands {
  perfCdp(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  perfLiveInstances(constructorName: string): Promise<number>;
}

const devtools = commands as unknown as PerfCommands;

async function collectGarbage(): Promise<void> {
  await devtools.perfCdp("HeapProfiler.collectGarbage");
  await sleep(50);
  await devtools.perfCdp("HeapProfiler.collectGarbage");
}

const liveInstances = (constructorName: string) => devtools.perfLiveInstances(constructorName);

async function heapUsed(): Promise<number> {
  const { usedSize } = (await devtools.perfCdp("Runtime.getHeapUsage")) as { usedSize: number };
  return usedSize;
}

async function detachedNodes(): Promise<number> {
  const { detachedNodes } = (await devtools.perfCdp("DOM.getDetachedDomNodes")) as { detachedNodes: unknown[] };
  return detachedNodes.length;
}

/** The page's JavaScript time so far, in ms. */
async function scriptMs(): Promise<number> {
  const { metrics } = (await devtools.perfCdp("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return (metrics.find((metric) => metric.name === "ScriptDuration")?.value ?? 0) * 1000;
}

async function throttle(rate: number): Promise<void> {
  await devtools.perfCdp("Emulation.setCPUThrottlingRate", { rate });
}

// ——— Measurements ———

/**
 * INP for one click: the longest Event Timing entry of the interaction, or 0
 * when every entry stayed under the 16 ms the API reports from.
 */
async function interaction(target: Element): Promise<number> {
  const entries: PerformanceEventTiming[] = [];
  const observer = new PerformanceObserver((list) => entries.push(...(list.getEntries() as PerformanceEventTiming[])));
  observer.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  await click(target);
  await drawn();
  await sleep(150);
  entries.push(...(observer.takeRecords() as PerformanceEventTiming[]));
  observer.disconnect();
  const timed = entries.filter((entry) => entry.interactionId > 0);
  return timed.length === 0 ? 0 : Math.max(...timed.map((entry) => entry.duration));
}

/**
 * Scrolls the list's frame to put `target` in its middle. Written out rather
 * than through scrollIntoView, whose options would put Tailwind utility names
 * in this file, which bb's build scans into the shipped app.css.
 */
function centerInFrame(target: HTMLElement): void {
  const frame = target.closest<HTMLElement>("[data-perf-frame]");
  if (frame === null) return;
  const rect = target.getBoundingClientRect();
  const view = frame.getBoundingClientRect();
  frame.scrollTop += rect.top - view.top - (view.height - rect.height) / 2;
}

/** Opens what `find` returns at 1× and 4× CPU, closing it again between. */
async function inpOf(slot: RenderedSlot, find: () => HTMLElement | undefined, close: () => HTMLElement | undefined): Promise<InpFigure | null> {
  const figure: InpFigure = { x1: null, x4: null };
  for (const rate of [1, 4] as const) {
    const target = find();
    if (target === undefined) return rate === 1 ? null : figure;
    centerInFrame(target);
    await drawn();
    await throttle(rate);
    const value = await interaction(target);
    await throttle(1);
    if (rate === 1) figure.x1 = value;
    else figure.x4 = value;
    const closer = close();
    if (closer !== undefined) {
      await click(closer);
      await drawn();
    }
  }
  void slot;
  return figure;
}

const byName = (root: ParentNode, pattern: RegExp) =>
  [...root.querySelectorAll<HTMLElement>("button")].filter((button) => pattern.test(button.getAttribute("aria-label") ?? ""));

/** Mounted rows outside the view extended 240 px, and rows inside it left unmounted. */
function windowCheck(frame: HTMLElement): { excess: number; missing: number } {
  const view = frame.getBoundingClientRect();
  const top = view.top - OVERSCAN;
  const bottom = view.bottom + OVERSCAN;
  let excess = 0;
  for (const anchor of anchors(frame)) {
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < top || rect.top > bottom) excess += 1;
  }
  let missing = 0;
  for (const placeholder of frame.querySelectorAll<HTMLElement>("[data-sidebar-windowed-nav]")) {
    const rect = placeholder.getBoundingClientRect();
    if (rect.bottom > view.top && rect.top < view.bottom) missing += (placeholder.dataset.sidebarWindowedNav ?? "").split(" ").filter(Boolean).length;
  }
  return { excess, missing };
}

/** Lets observers and effects settle after a change. */
async function quiet(): Promise<void> {
  for (let index = 0; index < 3; index += 1) await drawn();
  await sleep(200);
}

interface Mounted {
  host: FakeHost;
  app: PluginApp;
  server: ServerState;
  slot: RenderedSlot;
}

async function mountTimed(list: GeneratedList, frame: Frame, existing?: Omit<Mounted, "slot">): Promise<Mounted & { toFirstRowMs: number }> {
  const host =
    existing?.host ??
    createFakeHost({ threads: list.threads, projects: list.projects, freshActions: true, isCompactViewport: frame.width < 500 });
  const app = existing?.app ?? (await loadWithFakeHost());
  const server = existing?.server ?? serverState();
  const started = performance.now();
  const slot = mountList(app, server, frame);
  await until(() => slot.container.querySelector("[data-sidebar-thread-id]") !== null);
  await drawn();
  return { host, app, server, slot, toFirstRowMs: performance.now() - started };
}

/** Runs `run` with the clock stopped at the list's own moment, as the jsdom run's is. */
export async function atClockOf<T>(list: GeneratedList, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(list.now);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

export interface ChromiumOptions {
  /** Take only what does not depend on timing: rows mounted and the window checks. */
  deterministicOnly?: boolean;
}

/** Every Chromium measurement over one list. */
export async function runChromium(list: GeneratedList, { deterministicOnly = false }: ChromiumOptions = {}): Promise<ChromiumFigures> {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  localStorage.clear();
  const timing = !deterministicOnly;
  const first = await mountTimed(list, SIDEBAR);
  const { host, app, server } = first;
  let slot = first.slot;
  await quiet();
  const windowFigure = { checks: 0, excess: 0, missing: 0 };
  const check = () => {
    const { excess, missing } = windowCheck(frameOf(slot));
    windowFigure.checks += 1;
    windowFigure.excess += excess;
    windowFigure.missing += missing;
  };
  check();
  const rowsMounted = anchors(slot.container).length;

  // Remount to first row drawn.
  slot.unmount();
  cleanup();
  await quiet();
  const again = await mountTimed(list, SIDEBAR, { host, app, server });
  slot = again.slot;
  await quiet();

  // The rows 100 rows of scrolling bring into view.
  const frame = frameOf(slot);
  const rowHeight = anchors(frame)[0]!.parentElement!.getBoundingClientRect().height || 28;
  const scrollStarted = performance.now();
  frame.scrollTop += 100 * rowHeight;
  await until(() =>
    anchors(frame).some((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const view = frame.getBoundingClientRect();
      return rect.top >= view.top && rect.bottom <= view.bottom;
    }),
  );
  await drawn();
  const scrollMountMs = performance.now() - scrollStarted;
  await quiet();
  check();
  frame.scrollTop = 0;
  await quiet();

  // Opening a group, a children chip and the Settled fold, each closed again.
  const group = () => byName(slot.container, /^Expand .* section$/)[0];
  const collapseFirst = () => byName(slot.container, /^Collapse .* section$/)[0];
  const collapse = collapseFirst();
  if (collapse !== undefined) {
    await click(collapse);
    await quiet();
  }
  const inpGroup = timing ? await inpOf(slot, group, collapseFirst) : null;
  if (!timing && group() !== undefined) {
    await click(group()!);
  }
  await quiet();
  check();
  const childrenChip = () => byName(slot.container, /^Show \d+ child threads? of /)[0];
  const childrenChipClose = () => byName(slot.container, /^Collapse \d+ child threads? of /)[0];
  const inpChildrenChip = timing ? await inpOf(slot, childrenChip, childrenChipClose) : null;
  if (!timing && childrenChip() !== undefined) {
    await click(childrenChip()!);
    await quiet();
    check();
    await click(childrenChipClose()!);
  }
  await quiet();
  check();
  const fold = () => byName(slot.container, /^Show \d+ settled thread trees?$/)[0];
  const foldClose = () => byName(slot.container, /^Hide \d+ settled thread trees?$/)[0];
  const inpFold = timing ? await inpOf(slot, fold, foldClose) : null;
  if (!timing && fold() !== undefined) {
    await click(fold()!);
    await quiet();
    check();
    await click(foldClose()!);
  }
  await quiet();
  check();

  // The plugin's JavaScript per realtime event: a turn starting and finishing
  // on a thread on screen and on one scrolled out of view.
  const eventJsMs: Record<string, number> = {};
  if (timing) {
    frameOf(slot).scrollTop = 0;
    await quiet();
    const shown = anchors(slot.container);
    const onScreen = shown[0]!.dataset.sidebarThreadId!;
    const view = frameOf(slot).getBoundingClientRect();
    const offScreen =
      list.threads.map((thread) => thread.id).reverse().find((id) => {
        const anchor = slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`);
        return anchor === null || anchor.getBoundingClientRect().top > view.bottom;
      }) ?? onScreen;
    for (const [where, id] of [
      ["on screen", onScreen],
      ["off screen", offScreen],
    ] as const) {
      for (const phase of ["starts", "finishes"] as const) {
        const before = await scriptMs();
        const working = phase === "starts";
        host.updateThread(id, { status: working ? "active" : "idle", runtimeStatus: working ? "active" : "idle", updatedAt: Date.now() });
        await slot.emitRealtime(CHANNELS.stamps, { kind: working ? "startedAt" : "finishedAt", threadIds: [id], value: Date.now() });
        await quiet();
        eventJsMs[`turn ${phase} ${where}`] = Number(((await scriptMs()) - before).toFixed(2));
      }
    }
  }

  // Ten unmount and mount cycles, each read after a forced garbage collection.
  const cycles: ChromiumFigures["cycles"] = { heapGrowthBytes: 0, intersectionObservers: [], resizeObservers: [], detachedNodes: [] };
  if (timing) {
    let firstHeap = 0;
    for (let cycle = 0; cycle <= 10; cycle += 1) {
      if (cycle > 0) {
        slot.unmount();
        cleanup();
        await quiet();
        slot = (await mountTimed(list, SIDEBAR, { host, app, server })).slot;
        await quiet();
      }
      await collectGarbage();
      const heap = await heapUsed();
      if (cycle === 0) firstHeap = heap;
      else cycles.heapGrowthBytes = heap - firstHeap;
      cycles.intersectionObservers.push(await liveInstances("IntersectionObserver"));
      cycles.resizeObservers.push(await liveInstances("ResizeObserver"));
      cycles.detachedNodes.push(await detachedNodes());
    }
  }
  slot.unmount();
  cleanup();

  const phone = await runPhone(list, timing);
  return {
    build: process.env.NODE_ENV === "production" ? "production" : "development",
    inp: { group: inpGroup ?? { x1: null, x4: null }, childrenChip: inpChildrenChip ?? { x1: null, x4: null }, settledFold: inpFold },
    mountToFirstRowMs: Number(first.toFirstRowMs.toFixed(1)),
    remountToFirstRowMs: Number(again.toFirstRowMs.toFixed(1)),
    scrollMountMs: Number(scrollMountMs.toFixed(1)),
    rowsMounted,
    window: windowFigure,
    cycles,
    eventJsMs,
    phone,
  };
}

/** At 390×844: rows mounted in the closed drawer, then frame times scrolling it open. */
async function runPhone(list: GeneratedList, timing: boolean): Promise<ChromiumFigures["phone"]> {
  await page.viewport(PHONE.width, PHONE.height);
  localStorage.clear();
  const { slot } = await mountTimed(list, { ...PHONE, transform: "translateX(-100%)" });
  await quiet();
  const rowsMountedClosed = anchors(slot.container).length;
  const frame = frameOf(slot);
  frame.style.transform = "none";
  await quiet();
  const rowHeightPx = Math.round(anchors(frame)[0]?.parentElement?.getBoundingClientRect().height ?? 0);
  let openFrameMaxMs = 0;
  let openFrameP95Ms = 0;
  if (timing) {
    const frames: number[] = [];
    let last = await nextFrame();
    for (let index = 0; index < 90; index += 1) {
      frame.scrollTop += 40;
      const now = await nextFrame();
      frames.push(now - last);
      last = now;
    }
    const sorted = [...frames].sort((a, b) => a - b);
    openFrameMaxMs = Number(sorted.at(-1)!.toFixed(1));
    openFrameP95Ms = Number(sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1));
  }
  slot.unmount();
  cleanup();
  await page.viewport(DESKTOP.width, DESKTOP.height);
  return { rowsMountedClosed, rowHeightPx, openFrameMaxMs, openFrameP95Ms };
}

/** Mark all read on the MAR list: INP of the click at 1× and 4×, and main-thread time until the last answer. */
export async function runMarkAllReadChromium(makeList: () => GeneratedList): Promise<MarkAllReadTiming> {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const inp: InpFigure = { x1: null, x4: null };
  let mainThreadMs = 0;
  for (const rate of [1, 4] as const) {
    localStorage.clear();
    const list = makeList();
    const host = createFakeHost({ threads: list.threads, projects: list.projects, freshActions: true, markReadMs: 50 });
    const app = await loadWithFakeHost();
    const slot = mountList(app, serverState(), SIDEBAR);
    await until(() => slot.container.querySelector("[data-sidebar-thread-id]") !== null);
    await quiet();
    await click(slot.getByRole("button", { name: "Mark all read" }));
    await quiet();
    const confirm = markAllReadConfirm(slot);
    await throttle(rate);
    const before = await scriptMs();
    const value = await interaction(confirm);
    await host.markReadSettled();
    await quiet();
    const spent = (await scriptMs()) - before;
    await throttle(1);
    if (rate === 1) {
      inp.x1 = value;
      mainThreadMs = Number(spent.toFixed(1));
    } else inp.x4 = value;
    slot.unmount();
    cleanup();
  }
  return { inp, mainThreadMs };
}
