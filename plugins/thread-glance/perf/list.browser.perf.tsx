// `npm run perf`: the Chromium run over every generated list and the Mark all
// read list, on React's production build.
import "@/features/thread-list/testing/browser.css";
import { afterAll, it } from "vitest";
import { commands } from "vitest/browser";
import { generateList, markAllReadList } from "@/features/thread-list/testing/fixtures";
import { CELLS, parseCell, type Figures } from "./figures";
import { atClockOf, runChromium, runMarkAllReadChromium } from "./harness/chromium-run";

const figures: Partial<Figures> = { chromium: {}, markAllRead: {} };

afterAll(async () => {
  await commands.writeFile("perf/results/chromium.figures.json", JSON.stringify(figures, null, 2));
});

for (const cell of CELLS) {
  it(`times ${cell}`, async () => {
    const list = generateList(parseCell(cell));
    figures.chromium![cell] = await atClockOf(list, () => runChromium(list));
  });
}

it("times Mark all read on the Mark all read list", async () => {
  figures.markAllRead!.chromium = await atClockOf(markAllReadList(), () => runMarkAllReadChromium(markAllReadList));
});
