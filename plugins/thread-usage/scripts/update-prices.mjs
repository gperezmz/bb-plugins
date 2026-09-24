#!/usr/bin/env node
// Regenerates prices/litellm-prices.json: a trimmed, pinned snapshot of
// LiteLLM's model_prices_and_context_window.json (MIT, see
// prices/LICENSE-litellm.txt).
//
// Usage: node scripts/update-prices.mjs [--ref <commit-sha>]
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO = "BerriAI/litellm";
const FILE = "model_prices_and_context_window.json";
const MODES = new Set(["chat", "responses", "completion"]);
// Keys the plugin's pricing reads. Everything else is dropped.
const KEYS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
  "cache_creation_input_token_cost_above_1hr",
  "input_cost_per_token_above_200k_tokens",
  "output_cost_per_token_above_200k_tokens",
  "cache_read_input_token_cost_above_200k_tokens",
  "cache_creation_input_token_cost_above_200k_tokens",
  "input_cost_per_token_above_272k_tokens",
  "output_cost_per_token_above_272k_tokens",
  "cache_read_input_token_cost_above_272k_tokens",
  "cache_creation_input_token_cost_above_272k_tokens",
];

async function latestCommit() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/commits?path=${FILE}&per_page=1`,
    { headers: { accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub commits: HTTP ${res.status}`);
  const [commit] = await res.json();
  return { sha: commit.sha, date: commit.commit.committer.date };
}

export function trim(raw) {
  const models = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (name === "sample_spec" || entry === null || typeof entry !== "object") continue;
    if (entry.mode !== undefined && !MODES.has(entry.mode)) continue;
    if (typeof entry.input_cost_per_token !== "number") continue;
    if (typeof entry.output_cost_per_token !== "number") continue;
    const kept = {};
    for (const key of KEYS) {
      if (typeof entry[key] === "number" && Number.isFinite(entry[key])) kept[key] = entry[key];
    }
    models[name] = kept;
  }
  return models;
}

async function main() {
  const refIndex = process.argv.indexOf("--ref");
  const pinned =
    refIndex > 0
      ? { sha: process.argv[refIndex + 1], date: null }
      : await latestCommit();
  const url = `https://raw.githubusercontent.com/${REPO}/${pinned.sha}/${FILE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const models = trim(await res.json());
  const snapshot = {
    source: `https://github.com/${REPO}/blob/${pinned.sha}/${FILE}`,
    commit: pinned.sha,
    commitDate: pinned.date,
    fetchedAt: new Date().toISOString(),
    license: "MIT, Copyright (c) 2023 Berri AI; see LICENSE-litellm.txt",
    models,
  };
  const out = fileURLToPath(new URL("../prices/litellm-prices.json", import.meta.url));
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);
  console.log(`Wrote ${Object.keys(models).length} models from ${pinned.sha} to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
