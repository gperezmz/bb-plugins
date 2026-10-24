// The rules of reordering apart from the pointer: when a press is a drag,
// where the dragged unit goes, how fast the list scrolls near an edge, how far
// a row slides, and what a keyboard move announces.
import { describe, expect, it } from "vitest";
import type { ReorderList } from "./list-model";
import {
  afterHover,
  AUTOSCROLL_EDGE_PX,
  AUTOSCROLL_MAX_PX,
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  idsOfUnits,
  isDrag,
  keyboardMove,
  moveKeyTo,
  orderAfterReorder,
  pinNeighbours,
  rowPlaces,
  slideDelta,
  type ListUnit,
} from "./reorder";

const press = { x: 100, y: 100, button: 0, pointerType: "mouse" };

describe("when a press becomes a drag", () => {
  it("needs the left button, no touch, 6 px, and more vertical than sideways", () => {
    expect(isDrag(press, 100, 100 + DRAG_THRESHOLD_PX - 1)).toBe(false);
    expect(isDrag(press, 100, 100 + DRAG_THRESHOLD_PX)).toBe(true);
    expect(isDrag(press, 100, 94)).toBe(true);
    expect(isDrag(press, 120, 108)).toBe(false);
    expect(isDrag(press, 108, 108)).toBe(false);
    expect(isDrag({ ...press, button: 2 }, 100, 140)).toBe(false);
    expect(isDrag({ ...press, pointerType: "touch" }, 100, 140)).toBe(false);
    expect(isDrag({ ...press, pointerType: "pen" }, 100, 140)).toBe(true);
  });
});

describe("where the dragged unit goes", () => {
  const keys = ["a", "b", "c", "d"];
  it("takes the place of the unit it enters, in either direction", () => {
    expect(afterHover(keys, "a", { kind: "unit", unitKey: "b" })).toEqual(["b", "a", "c", "d"]);
    expect(afterHover(keys, "d", { kind: "unit", unitKey: "b" })).toEqual(["a", "d", "b", "c"]);
  });
  it("stays when the pointer is over itself or nothing", () => {
    expect(afterHover(keys, "b", { kind: "unit", unitKey: "b" })).toBe(keys);
    expect(afterHover(keys, "b", { kind: "none" })).toBe(keys);
  });
  it("goes to the first or last slot over empty space", () => {
    expect(afterHover(keys, "c", { kind: "edge", edge: "first" })).toEqual(["c", "a", "b", "d"]);
    expect(afterHover(keys, "b", { kind: "edge", edge: "last" })).toEqual(["a", "c", "d", "b"]);
  });
  it("moveKeyTo clamps and ignores unknown keys", () => {
    expect(moveKeyTo(keys, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(moveKeyTo(keys, "z", 0)).toBe(keys);
  });
});

describe("auto-scroll", () => {
  const edges = { top: 0, bottom: 500 };
  it("scrolls within 48 px of an edge, faster the closer, up to 14 px a frame", () => {
    expect(autoScrollStep(250, edges)).toBe(0);
    expect(autoScrollStep(AUTOSCROLL_EDGE_PX, edges)).toBe(0);
    expect(autoScrollStep(0, edges)).toBe(-AUTOSCROLL_MAX_PX);
    expect(autoScrollStep(-20, edges)).toBe(-AUTOSCROLL_MAX_PX);
    expect(autoScrollStep(500, edges)).toBe(AUTOSCROLL_MAX_PX);
    const near = autoScrollStep(500 - AUTOSCROLL_EDGE_PX / 2, edges);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(AUTOSCROLL_MAX_PX);
  });
});

describe("keyboard moves", () => {
  const list: ReorderList = {
    key: "active",
    label: "Active",
    units: ["a", "b", "c"].map((key) => ({ key, ids: [key], title: key.toUpperCase() })),
  };
  it("moves one slot and announces the place", () => {
    expect(keyboardMove(list, "a", 1)).toEqual({ moved: true, unitKeys: ["b", "a", "c"], announcement: "A moved to 2 of 3 in Active" });
    expect(keyboardMove(list, "c", -1)).toMatchObject({ moved: true, announcement: "C moved to 2 of 3 in Active" });
  });
  it("says when a unit is already first or last", () => {
    expect(keyboardMove(list, "a", -1)).toEqual({ moved: false, announcement: "A is already first in Active" });
    expect(keyboardMove(list, "c", 1)).toEqual({ moved: false, announcement: "C is already last in Active" });
  });
  it("names the Pinned list", () => {
    expect(keyboardMove({ ...list, label: "Pinned" }, "b", 1).announcement).toBe("B moved to 3 of 3 in Pinned");
  });
});

describe("writes", () => {
  it("sends the threads of the units in their new sequence", () => {
    const list: ReorderList = {
      key: "active",
      label: "Active",
      units: [
        { key: "group:p", ids: ["a1", "a2"], title: "P" },
        { key: "b", ids: ["b"], title: "B" },
      ],
    };
    expect(idsOfUnits(list, ["b", "group:p"])).toEqual(["b", "a1", "a2"]);
  });
  it("refills the places of the subset, counting in threads the order lacks", () => {
    expect(orderAfterReorder(["x", "a", "y", "b"], ["b", "a"])).toEqual(["x", "b", "y", "a"]);
    expect(orderAfterReorder(["x"], ["n", "a"])).toEqual(["n", "a", "x"]);
  });
  it("names the neighbours of a moved pin", () => {
    expect(pinNeighbours(["a", "b", "c"], "b")).toEqual({ previousThreadId: "a", nextThreadId: "c" });
    expect(pinNeighbours(["a", "b"], "a")).toEqual({ previousThreadId: null, nextThreadId: "b" });
  });
});

describe("slideDelta", () => {
  const header = (key: string, top: number): ListUnit => ({ kind: "header", key, top });
  const row = (id: string, top: number): ListUnit => ({ kind: "row", id, top });
  const delta = (before: ListUnit[], after: ListUnit[], id: string) => slideDelta(rowPlaces(before).get(id)!, rowPlaces(after).get(id)!);

  it("gives no slide to rows a shelf above pushes along with their header, opening or closing", () => {
    const open = [header("shelf:pinned", 0), row("p", 28), header("shelf:active", 100), row("a", 128), row("b", 200)];
    const closed = [header("shelf:pinned", 0), header("shelf:active", 28), row("a", 56), row("b", 128)];
    expect(delta(open, closed, "a")).toBe(0);
    expect(delta(open, closed, "b")).toBe(0);
    expect(delta(closed, open, "b")).toBe(0);
  });

  it("gives no slide to rows under a group a group above pushes along", () => {
    const before = [header("shelf:active", 0), header("group:x", 28), row("x1", 56), header("group:y", 128), row("y1", 156)];
    const after = [header("shelf:active", 0), header("group:x", 28), header("group:y", 56), row("y1", 84)];
    expect(delta(before, after, "y1")).toBe(0);
  });

  it("slides a row by its move within its header, and a row under another header from where it was", () => {
    const before = [header("shelf:active", 0), row("a", 28), row("b", 100), header("shelf:settled", 172), row("s", 200)];
    const after = [header("shelf:active", 0), row("b", 28), header("shelf:settled", 100), row("a", 128), row("s", 160)];
    expect(delta(before, after, "b")).toBe(72);
    expect(delta(before, after, "a")).toBe(28 - 128);
    expect(delta(before, after, "s")).toBe(28 - 60);
  });

  it("measures rows above the first header from the list's top", () => {
    expect(rowPlaces([row("a", 10)]).get("a")).toEqual({ header: null, top: 10, belowHeader: 10 });
  });
});
