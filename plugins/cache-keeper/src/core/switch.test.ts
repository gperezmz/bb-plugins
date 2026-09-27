import { describe, expect, it } from "vitest";
import { parseSettings } from "../server/settings";
import { keptWarm, treeTopOf, treeTopsBelow } from "./switch";

describe("keptWarm", () => {
  it("follows the setting while the switch is untouched", () => {
    expect(keptWarm("every", null)).toBe(true);
    expect(keptWarm("switched", null)).toBe(false);
    expect(keptWarm("never", null)).toBe(false);
  });

  it("keeps what was recorded under either other value, and sends none under Never", () => {
    for (const setting of ["every", "switched"] as const) {
      expect(keptWarm(setting, true)).toBe(true);
      expect(keptWarm(setting, false)).toBe(false);
    }
    expect(keptWarm("never", true)).toBe(false);
    expect(keptWarm("never", false)).toBe(false);
  });
});

describe("tree tops", () => {
  // root (pi) ─┬─ a (claude) ── a1 (claude) ── a2 (pi) ── a3 (claude)
  //            └─ b (pi) ── b1 (claude)
  const parents: Record<string, string | null> = { root: null, a: "root", a1: "a", a2: "a1", a3: "a2", b: "root", b1: "b", c: null, c1: "c" };
  const claude = new Set(["a", "a1", "a3", "b1", "c", "c1"]);
  const parentOf = (id: string) => parents[id];
  const isClaude = (id: string) => claude.has(id);
  const childrenOf = (id: string) => Object.keys(parents).filter((k) => parents[k] === id);

  it("is the Claude Code root of a tree with one, for every thread in it", () => {
    expect(treeTopOf("c", parentOf, isClaude)).toBe("c");
    expect(treeTopOf("c1", parentOf, isClaude)).toBe("c");
  });

  it("is each topmost Claude Code thread under a root that is not Claude Code", () => {
    expect(treeTopOf("a", parentOf, isClaude)).toBe("a");
    expect(treeTopOf("a3", parentOf, isClaude)).toBe("a");
    expect(treeTopOf("a2", parentOf, isClaude)).toBe("a");
    expect(treeTopOf("b1", parentOf, isClaude)).toBe("b1");
    expect(treeTopOf("root", parentOf, isClaude)).toBeNull();
    expect(treeTopOf("b", parentOf, isClaude)).toBeNull();
  });

  it("lists the tree tops below a thread with none above it", () => {
    expect(treeTopsBelow("root", childrenOf, isClaude)).toEqual(["a", "b1"]);
    expect(treeTopsBelow("b", childrenOf, isClaude)).toEqual(["b1"]);
    expect(treeTopsBelow("b1", childrenOf, isClaude)).toEqual([]);
  });
});

describe("settings", () => {
  it("default to keep-warms only on trees switched on, and check-ins on", () => {
    expect(parseSettings({})).toMatchObject({ keepWarm: "switched", checkIns: true });
  });

  it("read the three keep-warm choices and the check-in checkbox", () => {
    expect(parseSettings({ keepWarm: "Every waiting thread" }).keepWarm).toBe("every");
    expect(parseSettings({ keepWarm: "Only threads switched on" }).keepWarm).toBe("switched");
    expect(parseSettings({ keepWarm: "Never" }).keepWarm).toBe("never");
    expect(parseSettings({ stalledCheckIns: false }).checkIns).toBe(false);
    // The old checkbox is not carried over.
    expect(parseSettings({ checkIns: false }).checkIns).toBe(true);
  });
});
