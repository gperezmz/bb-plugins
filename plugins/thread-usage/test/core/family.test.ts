import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  familyIds,
  familyTree,
  forksOf,
  indexEdges,
  rootOf,
  unknownEdge,
  type Edge,
} from "../../src/core/family";

const edge = (threadId: string, p: Partial<Edge> = {}): Edge => ({ ...unknownEdge(threadId), createdAt: 0, ...p });

// manager
// ├── child (→ grandchild)
// ├── hidden, archived, deleted (→ deleted-kid), codex
// └── fork (sourceThreadId = manager) → fork-kid     [not family]
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

describe("family", () => {
  it("includes every descendant recursively, hidden, archived and deleted ones too", () => {
    const index = indexEdges(edges);
    expect(familyIds(index, "manager")).toEqual([
      "manager",
      "child",
      "grandchild",
      "hidden",
      "archived",
      "deleted",
      "deleted-kid",
      "codex",
    ]);
    const tree = familyTree(index, "manager");
    expect(tree.children.find((c) => c.edge.threadId === "child")!.children[0]!.depth).toBe(2);
  });

  it("excludes forks and their subtrees, and lists forks separately", () => {
    const index = indexEdges(edges);
    const ids = familyIds(index, "manager");
    expect(ids).not.toContain("fork");
    expect(ids).not.toContain("fork-kid");
    expect(forksOf(index, "manager").map((e) => e.threadId)).toEqual(["fork"]);
    // A fork is the top of its own family.
    expect(familyIds(index, "fork")).toEqual(["fork", "fork-kid"]);
    expect(ancestorIds(index, "fork-kid")).toEqual(["fork"]);
    expect(rootOf(index, "fork-kid")).toBe("fork");
  });

  it("scenario 13: re-parenting moves a subtree between families on the next index", () => {
    const moved = edges.map((e) => (e.threadId === "child" ? { ...e, parentThreadId: "codex" } : e));
    const before = indexEdges(edges);
    const after = indexEdges(moved);
    expect(familyIds(before, "codex")).toEqual(["codex"]);
    expect(familyIds(after, "codex")).toEqual(["codex", "child", "grandchild"]);
    expect(ancestorIds(after, "grandchild")).toEqual(["child", "codex", "manager"]);
    // Still under the manager, one level deeper.
    expect(familyIds(after, "manager")).toHaveLength(familyIds(before, "manager").length);
  });

  it("walks ancestors nearest first and finds the root", () => {
    const index = indexEdges(edges);
    expect(ancestorIds(index, "deleted-kid")).toEqual(["deleted", "manager"]);
    expect(rootOf(index, "deleted-kid")).toBe("manager");
    expect(rootOf(index, "manager")).toBe("manager");
  });

  it("cuts cycles", () => {
    const index = indexEdges([edge("a", { parentThreadId: "b" }), edge("b", { parentThreadId: "a" }), edge("self", { parentThreadId: "self" })]);
    expect(familyIds(index, "a")).toEqual(["a", "b"]);
    expect(ancestorIds(index, "a")).toEqual(["b"]);
    expect(familyIds(index, "self")).toEqual(["self"]);
    expect(ancestorIds(index, "self")).toEqual([]);
  });

  it("treats an unknown root as a family of one", () => {
    expect(familyIds(indexEdges(edges), "nobody")).toEqual(["nobody"]);
  });
});
