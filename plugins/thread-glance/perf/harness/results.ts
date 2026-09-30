// Where the steps of `npm run perf` leave their figures for the ledger step.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeFigures, type Figures } from "../figures";

// From the plugin's folder, where npm runs its scripts: under jsdom a
// module's URL is not a file path.
export const RESULTS_DIR = join(process.cwd(), "perf", "results");
/** The JSON file a run's numbers go to; PERF_OUT moves it. */
export const REPORT_JSON = process.env.PERF_OUT ?? join(RESULTS_DIR, "perf.json");

export function writeFragment(name: string, figures: Partial<Figures>): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${name}.figures.json`), JSON.stringify(figures, null, 2));
}

export function readFragments(): Figures {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const parts = readdirSync(RESULTS_DIR)
    .filter((file) => file.endsWith(".figures.json"))
    .map((file) => JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf8")) as Partial<Figures>);
  return mergeFigures(parts);
}
