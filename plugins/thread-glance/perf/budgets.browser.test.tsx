// The ledger's deterministic Chromium rows (rows mounted, the closed phone
// drawer) at 1,500 threads, live and settled: `npm test` fails when an
// enforcing one is missed (perf/ledger.ts). Timings run in `npm run perf`.
import "@/features/thread-list/testing/browser.css";
import { expect, it, vi } from "vitest";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { runChromium } from "./harness/chromium-run";

it("holds the enforcing deterministic Chromium budgets", async () => {
  const figures = emptyFigures();
  for (const scenario of ["live", "settled"] as const) {
    const list = generateList({ size: 1_500, scenario });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(list.now);
    try {
      figures.chromium[`1500/${scenario}`] = await runChromium(list, { deterministicOnly: true });
    } finally {
      vi.useRealTimers();
    }
  }
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
}, 900_000);
