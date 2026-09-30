// @vitest-environment jsdom
// The ledger's deterministic rows over the live lists at 50, 300 and 1,500
// threads, and the fake host's requests at 300: `npm test` fails when a
// row is missed (perf/ledger.ts). `npm run perf` takes them all.
import "./harness/render-counter";
import { afterEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures, SIZES } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { runHost } from "./harness/host-run";
import { runJsdom } from "./harness/jsdom-run";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("holds the deterministic budgets on the live lists", async () => {
  const figures = emptyFigures();
  for (const size of SIZES) {
    figures.jsdom[`${size}/live`] = await runJsdom(generateList({ size, kind: "live" }));
    cleanup();
    localStorage.clear();
  }
  figures.host["300/live"] = await runHost(generateList({ size: 300, kind: "live" }));
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
}, 900_000);
