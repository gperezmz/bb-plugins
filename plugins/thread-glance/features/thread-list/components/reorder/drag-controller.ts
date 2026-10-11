// The pointer side of reordering: it watches presses on the list's rows and
// group headers, turns one into a drag when the rules in model/reorder say so,
// follows the pointer, scrolls the list near its edges, and ends or abandons
// the drag. What the drag does to the order is the commands' (commands/reorder).
import type { ReorderCommands } from "../../commands/reorder";
import type { ListModel } from "../../model/list-model";
import { autoScrollStep, isDrag, unitInList, type Hover, type PressStart } from "../../model/reorder";
import { clippingAncestors } from "../view-tracker";

/** The elements a drag starts on and hovers over. */
const UNIT_SELECTOR = "[data-row-id],[data-group-key]";
/** Controls inside a row that keep their own press. */
const CONTROL_SELECTOR = "button,input,textarea,select,[data-no-drag]";

export interface DragControllerOptions {
  root: HTMLElement;
  commands: Pick<ReorderCommands, "beginDrag" | "hoverDrag" | "endDrag" | "cancelDrag" | "placeOf">;
  model(): ListModel | null;
  /** The element under a point; `document.elementFromPoint` unless a test stands in. */
  elementAt?(x: number, y: number): Element | null;
}

function keyOf(element: Element): string | null {
  return (element as HTMLElement).dataset.rowId ?? (element as HTMLElement).dataset.groupKey ?? null;
}

export function createDragController(options: DragControllerOptions): { dispose(): void } {
  const { root, commands } = options;
  const elementAt = options.elementAt ?? ((x: number, y: number) => document.elementFromPoint(x, y));
  let press: (PressStart & { key: string; listKey: string; unitKey: string }) | null = null;
  let dragging = false;
  let last = { x: 0, y: 0 };
  let frame: number | null = null;
  let scroller: HTMLElement | null = null;
  let removeWindowListeners: (() => void) | null = null;
  let removeSwallow: (() => void) | null = null;

  const unitElements = (listKey: string): Element[] => {
    const model = options.model();
    if (model === null) return [];
    return [...root.querySelectorAll(UNIT_SELECTOR)].filter((element) => {
      const key = keyOf(element);
      return key !== null && unitInList(model, key, listKey) !== null;
    });
  };

  const hoverAt = (x: number, y: number) => {
    if (press === null || !dragging) return;
    const model = options.model();
    if (model === null) return;
    const hit = elementAt(x, y)?.closest(UNIT_SELECTOR) ?? null;
    if (hit !== null && root.contains(hit)) {
      const key = keyOf(hit);
      const unit = key === null ? null : unitInList(model, key, press.listKey);
      if (unit !== null) {
        commands.hoverDrag({ kind: "unit", unitKey: unit });
        return;
      }
    }
    const rects = unitElements(press.listKey).map((element) => element.getBoundingClientRect());
    if (rects.length === 0) return;
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const hover: Hover = y < top ? { kind: "edge", edge: "first" } : y > bottom ? { kind: "edge", edge: "last" } : { kind: "none" };
    commands.hoverDrag(hover);
  };

  const scrollLoop = () => {
    frame = null;
    if (!dragging) return;
    if (scroller !== null) {
      const rect = scroller.getBoundingClientRect();
      const step = autoScrollStep(last.y, { top: rect.top, bottom: rect.bottom });
      if (step !== 0) {
        scroller.scrollTop += step;
        hoverAt(last.x, last.y);
      }
    }
    frame = requestAnimationFrame(scrollLoop);
  };

  const finish = () => {
    removeWindowListeners?.();
    removeWindowListeners = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    press = null;
    dragging = false;
    scroller = null;
  };

  /** Swallows the one click that follows a drop. */
  const swallowNextClick = () => {
    removeSwallow?.();
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      removeSwallow?.();
    };
    const clear = () => removeSwallow?.();
    window.addEventListener("click", swallow, true);
    window.addEventListener("pointerdown", clear, true);
    removeSwallow = () => {
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("pointerdown", clear, true);
      removeSwallow = null;
    };
  };

  const abandon = () => {
    if (dragging) commands.cancelDrag();
    finish();
  };

  const onMove = (event: PointerEvent) => {
    if (press === null) return;
    last = { x: event.clientX, y: event.clientY };
    if (!dragging) {
      if (!isDrag(press, event.clientX, event.clientY)) return;
      if (!commands.beginDrag(press.listKey, press.unitKey)) {
        finish();
        return;
      }
      dragging = true;
      const origin = root.querySelector(`[data-row-id="${CSS.escape(press.key)}"],[data-group-key="${CSS.escape(press.key)}"]`);
      scroller = origin === null ? null : (clippingAncestors(origin as HTMLElement)[0] ?? null);
      frame = requestAnimationFrame(scrollLoop);
    }
    hoverAt(event.clientX, event.clientY);
  };

  const onUp = () => {
    const wasDragging = dragging;
    finish();
    if (!wasDragging) return;
    commands.endDrag();
    swallowNextClick();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") abandon();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") abandon();
  };

  const onPointerDown = (event: PointerEvent) => {
    removeSwallow?.();
    if (event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as Element | null;
    const unit = target?.closest(UNIT_SELECTOR) ?? null;
    if (unit === null) return;
    const isGroup = (unit as HTMLElement).dataset.groupKey !== undefined;
    const control = target?.closest(CONTROL_SELECTOR) ?? null;
    if (!isGroup && control !== null && unit.contains(control)) return;
    const key = keyOf(unit);
    const place = key === null ? null : commands.placeOf(key);
    if (key === null || place === null) return;
    finish();
    press = { x: event.clientX, y: event.clientY, button: event.button, pointerType: event.pointerType, key, ...place };
    last = { x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", abandon, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", abandon);
    window.addEventListener("resize", abandon);
    window.addEventListener("pagehide", abandon);
    document.addEventListener("visibilitychange", onVisibility);
    removeWindowListeners = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", abandon, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", abandon);
      window.removeEventListener("resize", abandon);
      window.removeEventListener("pagehide", abandon);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  };

  root.addEventListener("pointerdown", onPointerDown);
  return {
    dispose() {
      root.removeEventListener("pointerdown", onPointerDown);
      abandon();
      removeSwallow?.();
    },
  };
}
