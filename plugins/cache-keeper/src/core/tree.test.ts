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
  it("sends only the leaf, at its own deadline, when the threads above come later", () => {
    const tree = [node({ id: "p", deadline: 59 * MIN, lifetimeMs: HOUR }), node({ id: "c", parentId: "p", deadline: 4 * MIN })];
    expect(planTree(tree, 4 * MIN - 1).due).toEqual([]);
    const plan = planTree(tree, 4 * MIN);
    expect(plan.due).toEqual([{ id: "c", tree: true }]);
    expect([...plan.planned].sort()).toEqual(["c", "p"]);
  });

  it("sends early enough for a thread above whose deadline comes first: its deadline less 60 s and 30 s a level", () => {
    const tree = [node({ id: "a", deadline: 3 * MIN }), node({ id: "b", parentId: "a", deadline: 10 * MIN, lifetimeMs: HOUR }), node({ id: "c", parentId: "b", deadline: 4 * MIN })];
    // a is two levels above c: 3 min less 120 s.
    expect(planTree(tree, MIN - 1).due).toEqual([]);
    expect(planTree(tree, MIN).due).toEqual([{ id: "c", tree: true }]);
    expect(planTree(tree, 0).wakeAt).toBe(MIN);
  });

  it("cycles once a cache lifetime less the minute's margin once the threads above trail their leaf", () => {
    // The parent's last request was its report turn, 3 s after the child's keep-warm.
    const tree = [node({ id: "p", deadline: 4 * MIN + 3 * S }), node({ id: "c", parentId: "p", deadline: 4 * MIN })];
    expect(planTree(tree, 4 * MIN - 1).due).toEqual([]);
    expect(planTree(tree, 4 * MIN).due).toEqual([{ id: "c", tree: true }]);
  });

  it("sends every leaf that could not wait for the next send at once, and leaves a later one for that send", () => {
    const tree = [
      node({ id: "p", deadline: 59 * MIN, lifetimeMs: HOUR }),
      node({ id: "a", parentId: "p", deadline: 4 * MIN }),
      node({ id: "b", parentId: "p", deadline: 5 * MIN }),
      node({ id: "c", parentId: "p", deadline: 9 * MIN }),
    ];
    expect(planTree(tree, 4 * MIN).due).toEqual([
      { id: "a", tree: true },
      { id: "b", tree: true },
    ]);
    // After that send a and b are due again at 8 min; c, due at 9, joins them.
    const after = tree.map((n) => (n.id === "a" || n.id === "b" ? { ...n, deadline: 8 * MIN } : n));
    expect(planTree(after, 8 * MIN - 1).due).toEqual([]);
    expect(planTree(after, 8 * MIN).due.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("holds the send while a keep-warm or a report is on its way, and lets the threads above wait 30 s for it", () => {
    const tree = [node({ id: "p", deadline: 4 * MIN + 3 * S }), node({ id: "c", parentId: "p", deadline: 8 * MIN, inFlight: true })];
    expect(planTree(tree, 4 * MIN + 3 * S).due).toEqual([]);
    expect(planTree(tree, 4 * MIN + 33 * S).due).toEqual([{ id: "p", tree: false }]);
    const pending = [node({ id: "p", deadline: 5 * MIN, reportPending: true }), node({ id: "c", parentId: "p", deadline: 9 * MIN })];
    expect(planTree(pending, 5 * MIN + 29 * S).due).toEqual([]);
    expect(planTree(pending, 5 * MIN + 30 * S).due).toEqual([{ id: "p", tree: false }]);
  });

  it("sends a parent its own keep-warm at its deadline when nothing below is on its way", () => {
    const tree = [node({ id: "p", deadline: 3 * MIN }), node({ id: "c", parentId: "p", deadline: 20 * MIN, lifetimeMs: HOUR })];
    // The child goes at the parent's deadline less 90 s; with that send held, the parent still gets its own.
    expect(planTree(tree, 90 * S).due).toEqual([{ id: "c", tree: true }]);
    const held = tree.map((n) => (n.id === "c" ? { ...n, keepable: false } : n));
    expect(planTree(held, 3 * MIN).due).toEqual([{ id: "p", tree: true }]);
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
    expect(planTree(tree("c"), 59 * MIN - 1).due).toEqual([]);
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

describe("a top whose deadline passes with its leaf's", () => {
  it("waits for the leaf's report rather than taking a keep-warm of its own in the same pass", () => {
    const top = { id: "p", parentId: null, keepable: true, deadline: 102_100, lifetimeMs: 300_000, blocks: false, selfOff: false, inFlight: false, reportPending: false };
    const leaf = { ...top, id: "c", parentId: "p", deadline: 100_000 };
    const plan = planTree([top, leaf], 103_000);
    expect(plan.due).toEqual([{ id: "c", tree: true }]);
  });
});
