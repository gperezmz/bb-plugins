// @vitest-environment jsdom
// The drag controller's scrolling: near an edge of the list's scroll area the
// list scrolls on each frame, up to 14 px, and stops when the drag ends.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSCROLL_MAX_PX } from "../../model/reorder";
import { createDragController } from "./drag-controller";

let frames: (() => void)[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => vi.unstubAllGlobals());

function runFrame() {
  const run = frames.shift();
  run?.();
}

function setup() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 200, width: 200, height: 500, x: 0, y: 0, toJSON: () => ({}) });
  const root = document.createElement("div");
  root.innerHTML = '<div data-row-id="a"><a>A</a></div><div data-row-id="b"><a>B</a></div>';
  scroller.append(root);
  document.body.append(scroller);
  const calls: string[] = [];
  const commands = {
    beginDrag: () => (calls.push("begin"), true),
    hoverDrag: () => void calls.push("hover"),
    endDrag: () => void calls.push("end"),
    cancelDrag: () => void calls.push("cancel"),
    placeOf: (key: string) => ({ listKey: "active", unitKey: key }),
  };
  const controller = createDragController({ root, commands, model: () => null, elementAt: () => null });
  const press = (y: number) =>
    root.querySelector("a")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: y, button: 0 }));
  const move = (y: number) => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: y }));
  return { scroller, calls, controller, press, move };
}

describe("auto-scroll", () => {
  it("scrolls down by up to 14 px a frame while the pointer is at the bottom edge, and stops on release", () => {
    const { scroller, calls, press, move, controller } = setup();
    press(300);
    move(310);
    move(500);
    expect(calls).toContain("begin");
    runFrame();
    expect(scroller.scrollTop).toBe(AUTOSCROLL_MAX_PX);
    runFrame();
    expect(scroller.scrollTop).toBe(2 * AUTOSCROLL_MAX_PX);
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(calls).toContain("end");
    const stopped = scroller.scrollTop;
    runFrame();
    expect(scroller.scrollTop).toBe(stopped);
    controller.dispose();
  });

  it("scrolls up near the top edge, and not at all in the middle", () => {
    const { scroller, press, move, controller } = setup();
    scroller.scrollTop = 100;
    press(250);
    move(260);
    move(250);
    runFrame();
    expect(scroller.scrollTop).toBe(100);
    move(10);
    runFrame();
    expect(scroller.scrollTop).toBeLessThan(100);
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(100 - AUTOSCROLL_MAX_PX);
    controller.dispose();
  });
});
