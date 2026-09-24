import { describe, expect, it } from "vitest";
import { parseApmManifest, parseApmReference } from "./apm.js";
import {
  globToRegExp,
  lineDiff,
  parseFrontmatter,
  planSync,
  selectSkillFolders,
  summarisePlan,
  validateSkill,
  type InstalledFolder,
  type Ownership,
  type SourceSkill,
} from "./skills.js";
import { compareVersions } from "./version.js";

const md = (name: string) => `---\nname: ${name}\ndescription: Does ${name} things.\n---\n\n# ${name}\n`;

describe("validateSkill", () => {
  it("accepts a well-formed skill", () => {
    expect(validateSkill("code-review", [{ path: "SKILL.md", type: "file", size: 40 }], md("code-review"))).toEqual({ ok: true, name: "code-review" });
  });

  // Acceptance 16: a name that differs from its folder is rejected with both named.
  it("rejects a name that differs from the folder", () => {
    const result = validateSkill("review", [], md("code-review"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('review/SKILL.md: name "code-review" differs from the folder "review"');
  });

  // Acceptance 7: a symlink outside the source is rejected with the file named.
  it("rejects a symlink pointing outside the source and names it", () => {
    const result = validateSkill(
      "tool",
      [
        { path: "SKILL.md", type: "file", size: 10 },
        { path: "scripts/run.sh", type: "symlink", size: 0, targetInsideSource: false },
      ],
      md("tool"),
    );
    expect(result).toEqual({ ok: false, reason: "tool/scripts/run.sh: a symlink that points outside the source" });
  });

  it("allows a symlink that stays inside the source", () => {
    const result = validateSkill("tool", [{ path: "shared.md", type: "symlink", size: 3, targetInsideSource: true }], md("tool"));
    expect(result.ok).toBe(true);
  });

  it("enforces bb's name pattern and per-skill limits", () => {
    expect(validateSkill("Bad_Name", [], md("Bad_Name")).ok).toBe(false);
    const many = Array.from({ length: 1001 }, (_, i) => ({ path: `f${i}`, type: "file" as const, size: 1 }));
    expect(validateSkill("big", many, md("big")).ok).toBe(false);
    expect(validateSkill("huge", [{ path: "blob", type: "file", size: 11 * 1024 * 1024 }], md("huge")).ok).toBe(false);
    expect(validateSkill("none", [], null).ok).toBe(false);
  });

  it("parses frontmatter", () => {
    expect(parseFrontmatter(md("x"))).toEqual({ name: "x", description: "Does x things." });
    expect(parseFrontmatter("no frontmatter")).toEqual({ name: null, description: null });
  });
});

describe("globs", () => {
  it("matches one segment with * and any with **", () => {
    expect(globToRegExp("skills/*").test("skills/a")).toBe(true);
    expect(globToRegExp("skills/*").test("skills/a/b")).toBe(false);
    expect(globToRegExp("skills/**").test("skills/a/b")).toBe(true);
    expect(globToRegExp(".").test("")).toBe(true);
  });

  it("selects folders with excludes", () => {
    expect(selectSkillFolders(["skills/a", "skills/experimental-b", "docs/c"], ["skills/*"], ["skills/experimental-*"])).toEqual(["skills/a"]);
  });
});

describe("planSync", () => {
  const source: SourceSkill[] = [
    { folder: "a", gitTree: "t-a2", skillMd: md("a") },
    { folder: "b", gitTree: "t-b1", skillMd: md("b") },
    { folder: "c", gitTree: "t-c1", skillMd: md("c") },
  ];
  const own = (folder: string, gitTree: string, treeHash: string, entryId = "team"): [string, Ownership] => [
    folder,
    { folder, entryId, sourceCommit: "c1", gitTree, treeHash },
  ];
  const disk = (folder: string, treeHash: string): [string, InstalledFolder] => [folder, { folder, treeHash, skillMd: md(folder) }];

  it("installs everything on a fresh root", () => {
    const plan = planSync("team", source, new Map(), new Map());
    expect(plan.actions.map((a) => a.kind)).toEqual(["install", "install", "install"]);
    expect(summarisePlan(plan)).toMatchObject({ outcome: "fail", category: "not-installed" });
  });

  it("finds updates, local edits, removals and hand-made folders", () => {
    const owned = new Map([own("a", "t-a1", "h-a"), own("b", "t-b1", "h-b"), own("old", "t-o", "h-o")]);
    const installed = new Map([disk("a", "h-a"), disk("b", "h-b-edited"), disk("c", "h-mine"), disk("old", "h-o")]);
    const plan = planSync("team", source, installed, owned);
    expect(Object.fromEntries(plan.actions.map((a) => [a.folder, a.kind]))).toEqual({
      a: "update",
      b: "edited",
      c: "conflict",
      old: "remove",
    });
    expect(plan.changed).toEqual(["a"]);
    expect(plan.removed).toEqual(["old"]);
  });

  // Acceptance 6: a hand-made folder with the same name fails; nothing is overwritten.
  it("fails on a hand-made folder with the same name", () => {
    const plan = planSync("team", [source[2]!], new Map([disk("c", "h-mine")]), new Map());
    expect(summarisePlan(plan)).toMatchObject({ outcome: "fail", category: "conflict" });
  });

  it("reports an update for a tracked branch that moved", () => {
    const plan = planSync("team", [source[0]!], new Map([disk("a", "h-a")]), new Map([own("a", "t-a1", "h-a")]));
    expect(summarisePlan(plan)).toMatchObject({ outcome: "update", detail: "Update available (changed: a)." });
  });

  it("reports edited locally as an update", () => {
    const plan = planSync("team", [source[1]!], new Map([disk("b", "changed")]), new Map([own("b", "t-b1", "h-b")]));
    expect(summarisePlan(plan)).toMatchObject({ outcome: "update", category: "edited" });
  });

  it("never touches folders another entry owns", () => {
    const plan = planSync("team", [source[1]!], new Map([disk("b", "h-b")]), new Map([own("b", "t-b1", "h-b", "other")]));
    expect(plan.actions[0]!.kind).toBe("owned-elsewhere");
  });

  it("passes when everything matches", () => {
    const plan = planSync("team", [source[1]!], new Map([disk("b", "h-b")]), new Map([own("b", "t-b1", "h-b")]));
    expect(summarisePlan(plan).outcome).toBe("pass");
  });
});

describe("lineDiff", () => {
  it("shows added and removed lines with context", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe("  a\n- b\n+ B\n  c");
  });
});

describe("apm", () => {
  it("parses package references", () => {
    expect(parseApmReference("example-org/skills/packages/eng#v1", "github.com")).toEqual({
      label: "example-org/skills/packages/eng#v1",
      url: "https://github.com/example-org/skills.git",
      ref: "v1",
      paths: ["packages/eng", "packages/eng/skills/*", "packages/eng/.apm/skills/*"],
    });
    expect(parseApmReference("nope", "github.com")).toBeNull();
  });

  it("reads dependencies.apm and ignores mcp", () => {
    const result = parseApmManifest(
      ["name: x", "dependencies:", "  apm:", "    - example-org/skills", "    - git: https://git.example.com/t/s.git", "      path: skills/a", "      ref: main", "  mcp: []"].join("\n"),
      "github.com",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources.map((s) => s.url)).toEqual(["https://github.com/example-org/skills.git", "https://git.example.com/t/s.git"]);
      expect(result.sources[1]!.ref).toBe("main");
    }
  });

  it("rejects malformed apm.yml", () => {
    expect(parseApmManifest("dependencies: { apm: 3 }", "github.com").ok).toBe(false);
    expect(parseApmManifest("{", "github.com").ok).toBe(false);
  });
});

describe("compareVersions", () => {
  it("compares numerically", () => {
    expect(compareVersions("2.101.0", "2.60")).toBe(1);
    expect(compareVersions("v22.1.0", "22")).toBe(1);
    expect(compareVersions("2.6", "2.60")).toBe(-1);
    expect(compareVersions("1.0.0", "1")).toBe(0);
  });
});
