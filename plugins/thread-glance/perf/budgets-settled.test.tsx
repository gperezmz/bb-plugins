// @vitest-environment jsdom
// The ledger's deterministic rows over the settled lists at 50, 300 and 1,500
// threads: `npm test` fails when one is missed (perf/ledger.ts).
import "./harness/render-counter";
import { afterEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures, SIZES } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { runJsdom } from "./harness/jsdom-run";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("holds the deterministic budgets on the settled lists", async () => {
  const figures = emptyFigures();
  for (const size of SIZES) {
    figures.jsdom[`${size}/settled`] = await runJsdom(generateList({ size, kind: "settled" }));
    cleanup();
    localStorage.clear();
  }
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
}, 900_000);
