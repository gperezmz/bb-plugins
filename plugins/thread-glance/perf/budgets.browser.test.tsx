// The ledger's deterministic Chromium rows (rows mounted, the closed phone
// drawer) at 1,500 threads, live and settled: `npm test` fails when an
// enforcing one is missed (perf/ledger.ts). Timings run in `npm run perf`.
import "@/features/thread-list/testing/browser.css";
import { expect, it } from "vitest";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures, SCENARIOS } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { atClockOf, runChromium } from "./harness/chromium-run";

it("holds the enforcing deterministic Chromium budgets", async () => {
  const figures = emptyFigures();
  for (const scenario of SCENARIOS) {
    const list = generateList({ size: 1_500, scenario });
    figures.chromium[`1500/${scenario}`] = await atClockOf(list, () => runChromium(list, { deterministicOnly: true }));
  }
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
}, 900_000);
