import { describe, expect, it } from "vitest";
import { ancestorIds, descendantIds, idsAbove, treeIds } from "./thread-tree";

const threads = [
  { id: "root", parentThreadId: null },
  { id: "a", parentThreadId: "root" },
  { id: "b", parentThreadId: "root" },
  { id: "a1", parentThreadId: "a" },
  { id: "other", parentThreadId: null },
];

describe("thread tree", () => {
  it("lists the threads below a thread, breadth first", () => {
    expect(descendantIds(threads, "root")).toEqual(["a", "b", "a1"]);
    expect(descendantIds(threads, "a1")).toEqual([]);
  });

  it("puts the root first in its tree", () => {
    expect(treeIds(threads, "a")).toEqual(["a", "a1"]);
  });

  it("lists the ancestors nearest first, and ends where a cycle closes", () => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    expect(ancestorIds(byId, "a1")).toEqual(["a", "root"]);
    const loop = new Map([
      ["x", { id: "x", parentThreadId: "y" }],
      ["y", { id: "y", parentThreadId: "x" }],
    ]);
    expect(ancestorIds(loop, "x")).toEqual(["y"]);
    expect(descendantIds([...loop.values()], "x")).toEqual(["y"]);
  });

  it("finds the threads with a picked thread below them, at any depth, not the picked thread itself", () => {
    expect([...idsAbove(threads, (thread) => thread.id === "a1")].sort()).toEqual(["a", "root"]);
    expect([...idsAbove(threads, (thread) => thread.id === "root")]).toEqual([]);
    expect([...idsAbove(threads, () => false)]).toEqual([]);
  });

  it("ends a chain at a parent it does not list", () => {
    const orphan = [{ id: "c", parentThreadId: "gone" }];
    expect([...idsAbove(orphan, () => true)]).toEqual(["gone"]);
    expect([...idsAbove([], () => true)]).toEqual([]);
  });
});
