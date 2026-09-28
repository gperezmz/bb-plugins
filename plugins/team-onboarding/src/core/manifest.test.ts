import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatIssue, manifestJsonSchema, parseManifest, REFUSED_ENV } from "./manifest.js";

const example = readFileSync(new URL("../../examples/onboarding.yaml", import.meta.url), "utf8");

describe("parseManifest", () => {
  it("accepts the shipped example and fills defaults", () => {
    const result = parseManifest(example);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.team.name).toBe("Example Platform");
    expect(result.manifest.github.mode).toBe("builtin");
    const git = result.manifest.skills.find((skill) => skill.source === "git");
    expect(git).toMatchObject({ ref: "main", paths: ["skills/*"] });
  });

  it("rejects an unknown source and names its line", () => {
    const result = parseManifest(
      ["schema: 1", "team: { name: T }", "skills:", "  - id: a", "    source: svn", "    url: https://example.com/a.git"].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues[0]!;
    expect(issue.line).toBe(5);
    expect(formatIssue(issue)).toContain('unknown source "svn"');
  });

  it("rejects an unknown fix kind with its line", () => {
    const result = parseManifest(
      ["schema: 1", "team: { name: T }", "checks:", "  - id: c", "    title: C", "    run: 'true'", "    fix: { kind: magic, command: x }"].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.line).toBe(7);
    expect(result.issues[0]!.message).toContain("unknown kind");
  });

  // Acceptance 22: a tools check that is a shell string is rejected, naming the line.
  it("rejects a tools check written as a shell string", () => {
    const result = parseManifest(
      ["schema: 1", "team: { name: T }", "tools:", "  - id: gh", '    check: "gh --version"'].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ line: 5, path: "tools[0].check" });
    expect(result.issues[0]!.message).toContain("not a shell string");
  });

  it("rejects a bin with a path or shell characters", () => {
    const result = parseManifest(
      ["schema: 1", "team: { name: T }", "tools:", "  - id: x", "    check: { bin: 'gh; rm -rf ~' }"].join("\n"),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate ids and unknown fields", () => {
    const result = parseManifest(
      ["schema: 1", "team: { name: T }", "tools:", "  - { id: a, check: { bin: a } }", "  - { id: a, check: { bin: b } }", "colour: blue"].join("\n"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const messages = result.issues.map((issue) => issue.message).join(" | ");
    expect(messages).toContain('duplicate id "a"');
    expect(messages).toContain('unknown field "colour"');
  });

  it("reports YAML syntax errors with a line", () => {
    const result = parseManifest("schema: 1\nteam: [unclosed\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.line).not.toBeNull();
  });

  it("needs exactly one of url or package for apm", () => {
    const result = parseManifest(["schema: 1", "team: { name: T }", "skills:", "  - { id: a, source: apm }"].join("\n"));
    expect(result.ok).toBe(false);
  });
});

const REFUSED_NAMES = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_GLOBAL"];
const FINE_NAMES = ["TRACKER_API_KEY", "GH_TOKEN_EXTRA", "MY_GITHUB_TOKEN", "GIT_CONFIGURED", "GIT_AUTHOR_NAME"];

describe("parseManifest env names", () => {
  const withEnv = (name: string) => ["schema: 1", "team: { name: T }", "env:", `  - name: ${name}`].join("\n");

  it.each(REFUSED_NAMES)(
    "rejects an env item named %s, naming the item and the rule",
    (name) => {
      const result = parseManifest(withEnv(name));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const issue = result.issues[0]!;
      expect(issue.line).toBe(4);
      expect(formatIssue(issue)).toContain(`${name} would override bb's built-in git`);
      expect(formatIssue(issue)).toContain("GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN and every name starting GIT_CONFIG_");
    },
  );

  it.each(FINE_NAMES)("accepts an env item named %s", (name) => {
    expect(parseManifest(withEnv(name)).ok).toBe(true);
  });
});

describe("parseManifest lines", () => {
  const lines = (...text: string[]) => {
    const result = parseManifest(text.join("\n"));
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.issues.map((issue) => [issue.line, issue.message] as const);
  };

  it("puts an unknown top-level field on its own line", () => {
    expect(lines("schema: 1", "team: { name: T }", "colour: blue")).toEqual([[3, 'unknown field "colour"']]);
  });

  it("puts an unknown nested field on its own line, not its parent's", () => {
    expect(lines("schema: 1", "team:", "  name: T", "  colour: blue")).toEqual([[4, 'unknown field "colour"']]);
    expect(lines("schema: 1", "team: { name: T }", "env:", "  - name: OK", "    note: n", "    colour: blue")).toEqual([
      [6, 'unknown field "colour"'],
    ]);
  });

  it("gives every unknown field its own issue and line", () => {
    expect(lines("schema: 1", "team:", "  name: T", "  a: 1", "", "  b: 2")).toEqual([
      [4, 'unknown field "a"'],
      [6, 'unknown field "b"'],
    ]);
  });

  it("puts a refused env name on the line of its name", () => {
    const result = lines("schema: 1", "team: { name: T }", "env:", "  - note: hi", "    name: GH_TOKEN");
    expect(result).toHaveLength(1);
    expect(result[0]![0]).toBe(5);
    expect(result[0]![1]).toContain("GH_TOKEN would override");
  });

  it("puts a malformed value on the line of its field", () => {
    expect(
      lines("schema: 1", "team: { name: T }", "tools:", "  - id: a", "    check: { bin: a }", "    min: banana")[0]![0],
    ).toBe(6);
  });

  it("puts a wrong-shaped block value on the line of its field, not its first child", () => {
    expect(lines("schema: 1", "team: { name: T }", "machines:", "  a: 1")[0]![0]).toBe(3);
    expect(lines("schema: 1", "team:", "  - a")[0]![0]).toBe(2);
  });

  it("puts an item missing a field on the line of the item", () => {
    expect(lines("schema: 1", "team: { name: T }", "", "env:", "  - note: x")[0]![0]).toBe(5);
  });
});

describe("manifestJsonSchema", () => {
  it("matches the committed schema/onboarding.schema.json", () => {
    const committed = JSON.parse(readFileSync(new URL("../../schema/onboarding.schema.json", import.meta.url), "utf8"));
    const { $id: _id, title: _title, ...rest } = committed;
    expect(rest).toEqual(JSON.parse(JSON.stringify(manifestJsonSchema())));
  });

  it("refuses the same env names as REFUSED_ENV", () => {
    const schema = JSON.parse(JSON.stringify(manifestJsonSchema())) as {
      properties: { env: { items: { properties: { name: { not?: { pattern: string } } } } } };
    };
    const refused = new RegExp(schema.properties.env.items.properties.name.not!.pattern);
    for (const name of [...REFUSED_NAMES, ...FINE_NAMES]) expect(refused.test(name), name).toBe(REFUSED_ENV.test(name));
    for (const name of REFUSED_NAMES) expect(refused.test(name), name).toBe(true);
    for (const name of FINE_NAMES) expect(refused.test(name), name).toBe(false);
  });
});
