// `npm run perf`, last step: reads every figure the run wrote, prints them as
// tables, one per generated list, with the ledger's reading, writes the same
// numbers to perf/results/perf.json (or PERF_OUT), and fails on any enforcing
// row missed, timing rows included.
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { evaluate, failures } from "./ledger";
import { formatReport, reportJson } from "./report";
import { readFragments, REPORT_JSON } from "./harness/results";

it("holds every enforcing budget", () => {
  const figures = readFragments();
  const verdicts = evaluate(figures);
  console.log(formatReport(figures, verdicts));
  writeFileSync(REPORT_JSON, reportJson(figures, verdicts));
  console.log(`\nWrote ${REPORT_JSON}`);
  expect(failures(verdicts)).toEqual([]);
});
