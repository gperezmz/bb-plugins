// Parses every Mermaid block in the repository's tracked Markdown files and
// reports each block that fails, with its file and line. Parsing needs no
// browser, but mermaid sanitises labels with DOMPurify, which needs a DOM, so
// jsdom provides one.
//
//   npm ci --prefix scripts/ci && node scripts/ci/check-mermaid.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("");
globalThis.window = window;
globalThis.document = window.document;
const { default: mermaid } = await import("mermaid");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

mermaid.initialize({ startOnLoad: false });

let blocks = 0;
let failures = 0;
for (const file of files) {
  const lines = readFileSync(`${root}/${file}`, "utf8").split("\n");
  for (let start = 0; start < lines.length; start++) {
    if (lines[start].trim() !== "```mermaid") continue;
    const end = lines.findIndex((line, index) => index > start && line.trim() === "```");
    if (end === -1) {
      console.error(`${file}:${start + 1}: unclosed mermaid block`);
      failures++;
      break;
    }
    blocks++;
    try {
      await mermaid.parse(lines.slice(start + 1, end).join("\n"));
    } catch (error) {
      console.error(`${file}:${start + 1}: ${error.message}`);
      failures++;
    }
    start = end;
  }
}

console.log(`${blocks} mermaid blocks in ${files.length} files, ${failures} failing`);
process.exitCode = failures ? 1 : 0;
