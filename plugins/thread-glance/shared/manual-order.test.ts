import { describe, expect, it } from "vitest";
import {
  applySubsetOrder,
  dedupeOrder,
  insertAtTop,
  moveByOne,
  reconcileOrder,
  sortByManualOrder,
} from "./manual-order";

describe("manual order", () => {
  it("puts new threads at the top and leaves listed ones where they are", () => {
    expect(insertAtTop(["a", "b"], ["n", "b"])).toEqual(["n", "a", "b"]);
    expect(insertAtTop(["a"], ["a"])).toEqual(["a"]);
  });

  it("moves a subset into a new sequence and leaves the others in their places", () => {
    // b and d are the subset; they swap and a, c, e keep their places.
    expect(applySubsetOrder(["a", "b", "c", "d", "e"], ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("ignores subset ids the list does not hold and repeated ids", () => {
    expect(applySubsetOrder(["a", "b", "c"], ["c", "gone", "c", "a"])).toEqual(["c", "b", "a"]);
  });

  it("drops threads that are gone and puts live ones the list lacks at the top, newest first", () => {
    const live = [
      { id: "a", createdAt: 1 },
      { id: "b", createdAt: 2 },
      { id: "new1", createdAt: 10 },
      { id: "new2", createdAt: 20 },
    ];
    expect(reconcileOrder(["b", "gone", "a", "b"], live)).toEqual(["new2", "new1", "b", "a"]);
  });

  it("sorts threads by the order and puts unlisted ones first", () => {
    const threads = [
      { id: "a", createdAt: 1 },
      { id: "b", createdAt: 2 },
      { id: "n", createdAt: 3 },
    ];
    expect(sortByManualOrder(threads, ["b", "a"]).map((thread) => thread.id)).toEqual(["n", "b", "a"]);
  });

  it("moves a thread one place and reports the edges", () => {
    expect(moveByOne(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveByOne(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveByOne(["a", "b", "c"], "a", -1)).toBeNull();
    expect(moveByOne(["a", "b", "c"], "c", 1)).toBeNull();
    expect(moveByOne(["a"], "z", 1)).toBeNull();
  });

  it("removes repeated ids", () => {
    expect(dedupeOrder(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});
