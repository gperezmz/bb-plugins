/// <reference types="vite/client" />
// The Chromium run: the list mounted through the fake host in a sidebar-sized
// scroll area, timed with Event Timing and the Chrome DevTools Protocol
// (forced garbage collection, heap, live observers, detached nodes, script
// time). Runs in vitest browser mode; `deterministicOnly` takes the figures
// that do not depend on timing, for `npm test`.
import { cleanup } from "@testing-library/react";
import { cdp, page, userEvent } from "vitest/browser";
import type { RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import { CHANNELS } from "@/shared/contract";
import type { GeneratedList } from "@/features/thread-list/testing/fixtures";
import { createFakeHost, loadWithFakeHost, mountList, serverState, type FakeHost, type Frame, type ServerState } from "./fake-host";
import type { ChromiumFigures, InpFigure, MarkAllReadTiming } from "./chromium-figures";

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

// ——— The DevTools protocol, through vitest's session for this page ———

interface Session {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  on(event: string, listener: (payload: Record<string, unknown>) => void): void;
}

let session: Session | null = null;
let testContextId: number | null = null;

/** This test frame's execution context, where the list's objects live. */
async function protocol(): Promise<{ session: Session; contextId: number }> {
  if (session !== null && testContextId !== null) return { session, contextId: testContextId };
  session = cdp() as unknown as Session;
  const contexts: { id: number; auxData?: { frameId?: string; isDefault?: boolean } }[] = [];
  session.on("Runtime.executionContextCreated", (event) => contexts.push(event.context as never));
  await session.send("Runtime.enable");
  await session.send("Performance.enable");
  const marker = `__perf_${Math.random().toString(36).slice(2)}`;
  (window as unknown as Record<string, boolean>)[marker] = true;
  for (const context of contexts) {
    const { result } = (await session.send("Runtime.evaluate", {
      expression: `globalThis.${marker} === true`,
      contextId: context.id,
      returnByValue: true,
    })) as { result: { value?: boolean } };
    if (result.value === true) testContextId = context.id;
  }
  if (testContextId === null) throw new Error("no DevTools execution context for the test frame");
  return { session, contextId: testContextId };
}

async function collectGarbage(): Promise<void> {
  const { session } = await protocol();
  await session.send("HeapProfiler.collectGarbage");
  await sleep(50);
  await session.send("HeapProfiler.collectGarbage");
}

async function liveInstances(constructorName: string): Promise<number> {
  const { session, contextId } = await protocol();
  const prototype = (await session.send("Runtime.evaluate", { expression: `${constructorName}.prototype`, contextId })) as {
    result: { objectId: string };
  };
  const found = (await session.send("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId })) as {
    objects: { objectId: string };
  };
  const length = (await session.send("Runtime.callFunctionOn", {
    functionDeclaration: "function () { return this.length; }",
    objectId: found.objects.objectId,
    returnByValue: true,
  })) as { result: { value: number } };
  await session.send("Runtime.releaseObject", { objectId: found.objects.objectId });
  await session.send("Runtime.releaseObject", { objectId: prototype.result.objectId });
  return length.result.value;
}

async function heapUsed(): Promise<number> {
  const { session } = await protocol();
  const { usedSize } = (await session.send("Runtime.getHeapUsage")) as { usedSize: number };
  return usedSize;
}

async function detachedNodes(): Promise<number> {
  const { session } = await protocol();
  const { detachedNodes } = (await session.send("DOM.getDetachedDomNodes")) as { detachedNodes: unknown[] };
  return detachedNodes.length;
}

/** The page's JavaScript time so far, in ms. */
async function scriptMs(): Promise<number> {
  const { session } = await protocol();
  const { metrics } = (await session.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return (metrics.find((metric) => metric.name === "ScriptDuration")?.value ?? 0) * 1000;
}

async function throttle(rate: number): Promise<void> {
  const { session } = await protocol();
  await session.send("Emulation.setCPUThrottlingRate", { rate });
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

/** Opens what `find` returns at 1× and 4× CPU, closing it again between. */
async function inpOf(slot: RenderedSlot, find: () => HTMLElement | undefined, close: () => HTMLElement | undefined): Promise<InpFigure | null> {
  const figure: InpFigure = { x1: null, x4: null };
  for (const rate of [1, 4] as const) {
    const target = find();
    if (target === undefined) return rate === 1 ? null : figure;
    target.scrollIntoView({ block: "center" });
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
  const chip = () => byName(slot.container, /^Show \d+ child threads? of /)[0];
  const chipClose = () => byName(slot.container, /^Collapse \d+ child threads? of /)[0];
  const inpChip = timing ? await inpOf(slot, chip, chipClose) : null;
  if (!timing && chip() !== undefined) {
    await click(chip()!);
    await quiet();
    check();
    await click(chipClose()!);
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
    build: import.meta.env.PROD ? "production" : "development",
    inp: { group: inpGroup ?? { x1: null, x4: null }, chip: inpChip ?? { x1: null, x4: null }, settledFold: inpFold },
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
    const host = createFakeHost({ threads: list.threads, projects: list.projects, freshActions: true, setReadMs: 50 });
    const app = await loadWithFakeHost();
    const slot = mountList(app, serverState(), SIDEBAR);
    await until(() => slot.container.querySelector("[data-sidebar-thread-id]") !== null);
    await quiet();
    await click(slot.getByRole("button", { name: "Mark all read" }));
    await quiet();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
      (button) => button.textContent?.trim() === "Mark all read",
    );
    await throttle(rate);
    const before = await scriptMs();
    const value = await interaction(confirm ?? slot.getByRole("button", { name: "Mark all read" }));
    await host.setReadSettled();
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
