// The ledger's deterministic Chromium rows (rows mounted, the closed phone
// drawer) at 1,500 threads, live and settled, and a drag over rows not mounted when it began: `npm test` fails when a
// row is missed (perf/ledger.ts). Timings run in `npm run perf`.
import "@/features/thread-list/testing/browser.css";
import { expect, it } from "vitest";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures, LIST_KINDS } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { atClockOf, runChromium } from "./harness/chromium-run";

it("holds the deterministic Chromium budgets", async () => {
  const figures = emptyFigures();
  for (const kind of LIST_KINDS) {
    const list = generateList({ size: 1_500, kind });
    figures.chromium[`1500/${kind}`] = await atClockOf(list, () => runChromium(list, { deterministicOnly: true }));
  }
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
  // #159: a drag scrolls the list at its edges and drops onto rows mounted since it began.
  for (const kind of LIST_KINDS) {
    const far = figures.chromium[`1500/${kind}`]!.dragFar!;
    expect(far, kind).toMatchObject({ draggedStayed: true, targetWasMounted: false, nested: true });
    expect(far.scrolledDownPx, kind).toBeGreaterThan(0);
    expect(far.scrolledUpPx, kind).toBeGreaterThan(0);
  }
}, 900_000);
