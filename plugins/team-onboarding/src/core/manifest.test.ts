import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatIssue, manifestJsonSchema, parseManifest } from "./manifest.js";

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

describe("parseManifest env names", () => {
  const withEnv = (name: string) => ["schema: 1", "team: { name: T }", "env:", `  - name: ${name}`].join("\n");

  it.each(["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_GLOBAL"])(
    "rejects an env item named %s, naming the item and the rule",
    (name) => {
      const result = parseManifest(withEnv(name));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const issue = result.issues[0]!;
      expect(issue.line).toBe(4);
      expect(formatIssue(issue)).toContain(`${name} would override bb's built-in git`);
    },
  );

  it.each(["TRACKER_API_KEY", "GH_TOKEN_EXTRA", "MY_GITHUB_TOKEN", "GIT_CONFIGURED", "GIT_AUTHOR_NAME"])("accepts an env item named %s", (name) => {
    expect(parseManifest(withEnv(name)).ok).toBe(true);
  });
});

describe("manifestJsonSchema", () => {
  it("matches the committed schema/onboarding.schema.json", () => {
    const committed = JSON.parse(readFileSync(new URL("../../schema/onboarding.schema.json", import.meta.url), "utf8"));
    const { $id: _id, title: _title, ...rest } = committed;
    expect(rest).toEqual(JSON.parse(JSON.stringify(manifestJsonSchema())));
  });
});
