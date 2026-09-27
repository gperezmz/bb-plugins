import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  treeIds,
  treeOf,
  forksOf,
  indexEdges,
  rootOf,
  unknownEdge,
  type Edge,
} from "../../src/core/tree";

const edge = (threadId: string, p: Partial<Edge> = {}): Edge => ({ ...unknownEdge(threadId), createdAt: 0, ...p });

// manager
// ├── child (→ grandchild)
// ├── hidden, archived, deleted (→ deleted-kid), codex
// └── fork (sourceThreadId = manager) → fork-kid     [not in the tree]
const edges = [
  edge("manager"),
  edge("child", { parentThreadId: "manager", createdAt: 1 }),
  edge("grandchild", { parentThreadId: "child", createdAt: 2 }),
  edge("hidden", { parentThreadId: "manager", hidden: true, createdAt: 3 }),
  edge("archived", { parentThreadId: "manager", archivedAt: 10, createdAt: 4 }),
  edge("deleted", { parentThreadId: "manager", deletedAt: 11, createdAt: 5 }),
  edge("deleted-kid", { parentThreadId: "deleted", createdAt: 6 }),
  edge("codex", { parentThreadId: "manager", providerId: "codex", createdAt: 7 }),
  edge("fork", { parentThreadId: "manager", sourceThreadId: "manager", createdAt: 8 }),
  edge("fork-kid", { parentThreadId: "fork", createdAt: 9 }),
];

describe("tree", () => {
  it("includes every descendant recursively, hidden, archived and deleted ones too", () => {
    const index = indexEdges(edges);
    expect(treeIds(index, "manager")).toEqual([
      "manager",
      "child",
      "grandchild",
      "hidden",
      "archived",
      "deleted",
      "deleted-kid",
      "codex",
    ]);
    const tree = treeOf(index, "manager");
    expect(tree.children.find((c) => c.edge.threadId === "child")!.children[0]!.depth).toBe(2);
  });

  it("excludes forks and their subtrees, and lists forks separately", () => {
    const index = indexEdges(edges);
    const ids = treeIds(index, "manager");
    expect(ids).not.toContain("fork");
    expect(ids).not.toContain("fork-kid");
    expect(forksOf(index, "manager").map((e) => e.threadId)).toEqual(["fork"]);
    // A fork is the top of its own tree.
    expect(treeIds(index, "fork")).toEqual(["fork", "fork-kid"]);
    expect(ancestorIds(index, "fork-kid")).toEqual(["fork"]);
    expect(rootOf(index, "fork-kid")).toBe("fork");
  });

  it("scenario 13: re-parenting moves a subtree between trees on the next index", () => {
    const moved = edges.map((e) => (e.threadId === "child" ? { ...e, parentThreadId: "codex" } : e));
    const before = indexEdges(edges);
    const after = indexEdges(moved);
    expect(treeIds(before, "codex")).toEqual(["codex"]);
    expect(treeIds(after, "codex")).toEqual(["codex", "child", "grandchild"]);
    expect(ancestorIds(after, "grandchild")).toEqual(["child", "codex", "manager"]);
    // Still under the manager, one level deeper.
    expect(treeIds(after, "manager")).toHaveLength(treeIds(before, "manager").length);
  });

  it("walks ancestors nearest first and finds the root", () => {
    const index = indexEdges(edges);
    expect(ancestorIds(index, "deleted-kid")).toEqual(["deleted", "manager"]);
    expect(rootOf(index, "deleted-kid")).toBe("manager");
    expect(rootOf(index, "manager")).toBe("manager");
  });

  it("cuts cycles", () => {
    const index = indexEdges([edge("a", { parentThreadId: "b" }), edge("b", { parentThreadId: "a" }), edge("self", { parentThreadId: "self" })]);
    expect(treeIds(index, "a")).toEqual(["a", "b"]);
    expect(ancestorIds(index, "a")).toEqual(["b"]);
    expect(treeIds(index, "self")).toEqual(["self"]);
    expect(ancestorIds(index, "self")).toEqual([]);
  });

  it("treats an unknown root as a tree of one", () => {
    expect(treeIds(indexEdges(edges), "nobody")).toEqual(["nobody"]);
  });
});
