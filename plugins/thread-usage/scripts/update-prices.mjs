#!/usr/bin/env node
// Regenerates prices/models-dev-prices.json: the copy of models.dev's
// api.json (MIT, see prices/LICENSE-models-dev.txt) that the plugin uses until
// it has fetched a newer one, trimmed by the same code the server runs on the
// fetched list.
//
// Usage: node scripts/update-prices.mjs
// Needs Node 22.18 or later, which runs the TypeScript source directly.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MODELS_DEV_URL, trimModelsDev } from "../src/core/models-dev.ts";

async function main() {
  const res = await fetch(MODELS_DEV_URL);
  if (!res.ok) throw new Error(`${MODELS_DEV_URL}: HTTP ${res.status}`);
  const models = trimModelsDev(await res.json());
  const snapshot = {
    source: MODELS_DEV_URL,
    fetchedAt: new Date().toISOString(),
    license: "MIT, Copyright (c) 2025 models.dev; see LICENSE-models-dev.txt",
    models,
  };
  const out = fileURLToPath(new URL("../prices/models-dev-prices.json", import.meta.url));
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);
  console.log(`Wrote ${Object.keys(models).length} models to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
