// The skill reaches agents only through the manifest's `bb.skills` and the
// package's `files`; dropping either removes it from installs without an error.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const plugin = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8")) as {
  bb: { skills?: string[] };
  files: string[];
};

it("ships the thread-glance skill: declared in bb.skills, listed in files, named in its frontmatter", () => {
  expect(manifest.bb.skills).toEqual(["skills"]);
  expect(manifest.files).toContain("skills");
  const file = join(plugin, "skills", "thread-glance", "SKILL.md");
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8")).toMatch(/^---\nname: thread-glance\ndescription: .+\n---\n/);
});
