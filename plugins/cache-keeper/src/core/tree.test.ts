import { describe, expect, it } from "vitest";
import { planTree, topOf, type TreeNode } from "./tree";

const S = 1_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;

const node = (over: Partial<TreeNode> & { id: string }): TreeNode => ({
  parentId: null,
  keepable: true,
  deadline: 4 * MIN,
  lifetimeMs: 5 * MIN,
  blocks: false,
  selfOff: false,
  inFlight: false,
  reportPending: false,
  ...over,
});

describe("tree keep-warm", () => {
  it("sends only to the leaf, 90 seconds before the earliest deadline of a 1-hour parent over a 5-minute child", () => {
    const tree = [node({ id: "p", deadline: 59 * MIN, lifetimeMs: HOUR }), node({ id: "c", parentId: "p", deadline: 4 * MIN })];
    expect(planTree(tree, 4 * MIN - 91 * S).due).toEqual([]);
    const plan = planTree(tree, 4 * MIN - 90 * S);
    expect(plan.due).toEqual([{ id: "c", tree: true }]);
    expect([...plan.planned].sort()).toEqual(["c", "p"]);
  });

  it("adds 30 seconds of lead for each level down to the deepest leaf in the send", () => {
    const tree = [node({ id: "a", deadline: 50 * MIN, lifetimeMs: HOUR }), node({ id: "b", parentId: "a", deadline: 10 * MIN }), node({ id: "c", parentId: "b" })];
    expect(planTree(tree, 4 * MIN - 121 * S).due).toEqual([]);
    expect(planTree(tree, 4 * MIN - 120 * S).due).toEqual([{ id: "c", tree: true }]);
    expect(planTree(tree, 0).wakeAt).toBe(4 * MIN - 120 * S);
  });

  it("sends every leaf due before the next send at once, and leaves a later one for that send", () => {
    const tree = [
      node({ id: "p", deadline: 59 * MIN, lifetimeMs: HOUR }),
      node({ id: "a", parentId: "p", deadline: 4 * MIN }),
      node({ id: "b", parentId: "p", deadline: 4 * MIN + 30 * S }),
      node({ id: "c", parentId: "p", deadline: 7 * MIN }),
    ];
    expect(planTree(tree, 4 * MIN - 90 * S).due).toEqual([
      { id: "a", tree: true },
      { id: "b", tree: true },
    ]);
    // After that send, a and b are due again 4 minutes on; c, due at 7, joins their next send.
    const after = tree.map((n) => (n.id === "a" || n.id === "b" ? { ...n, deadline: 4 * MIN - 90 * S + 4 * MIN } : n));
    expect(planTree(after, 5 * MIN - 1).due).toEqual([]);
    expect(planTree(after, 5 * MIN).due.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("holds the send while a keep-warm or a report is still on its way, but keeps each thread's own deadline", () => {
    const tree = [node({ id: "p", deadline: 5 * MIN, lifetimeMs: 5 * MIN }), node({ id: "c", parentId: "p", deadline: 4 * MIN, inFlight: true })];
    expect(planTree(tree, 4 * MIN - 30 * S).due).toEqual([]);
    expect(planTree(tree, 5 * MIN).due).toEqual([{ id: "p", tree: false }]);
    const pending = [node({ id: "p", deadline: 5 * MIN, reportPending: true }), node({ id: "c", parentId: "p", deadline: 9 * MIN })];
    expect(planTree(pending, 5 * MIN + 10 * S).due).toEqual([]);
    expect(planTree(pending, 5 * MIN + 20 * S).due).toEqual([{ id: "p", tree: false }]);
  });

  it("sends a parent its own keep-warm at its deadline when no report refreshed it", () => {
    const tree = [node({ id: "p", deadline: 3 * MIN }), node({ id: "c", parentId: "p", deadline: 20 * MIN, lifetimeMs: HOUR })];
    expect(planTree(tree, 3 * MIN).due).toEqual([{ id: "p", tree: false }]);
  });

  it("sends nothing below a skipped or cost-stopped thread", () => {
    const tree = (blocks: string) => [
      node({ id: "p", deadline: 59 * MIN, lifetimeMs: HOUR, blocks: blocks === "p" }),
      node({ id: "c", parentId: "p", blocks: blocks === "c" }),
      node({ id: "g", parentId: "c" }),
    ];
    expect(planTree(tree("p"), 5 * MIN).due).toEqual([]);
    expect(planTree(tree("p"), 0).planned.size).toBe(0);
    const plan = planTree(tree("c"), 59 * MIN);
    expect(plan.due).toEqual([{ id: "p", tree: true }]);
    expect(plan.planned.has("c")).toBe(false);
  });

  it("does not send to a thread whose cache already went cold", () => {
    expect(planTree([node({ id: "t", deadline: 0 })], 61 * S).due).toEqual([]);
  });
});

describe("top-level thread", () => {
  it("follows parents up, stopping at a loop", () => {
    const parents: Record<string, string | null> = { a: null, b: "a", c: "b", x: "y", y: "x" };
    expect(topOf("c", (id) => parents[id])).toBe("a");
    expect(topOf("x", (id) => parents[id])).toBe("y");
  });
});
