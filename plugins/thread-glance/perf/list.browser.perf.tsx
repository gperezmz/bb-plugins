// `npm run perf`: the Chromium run over every generated list and the Mark all
// read list, on React's production build.
import "@/features/thread-list/testing/browser.css";
import { afterAll, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { generateList, markAllReadList } from "@/features/thread-list/testing/fixtures";
import { CELLS, type Figures } from "./figures";
import { runChromium, runMarkAllReadChromium } from "./harness/chromium-run";

const figures: Partial<Figures> = { chromium: {}, markAllRead: {} };

afterAll(async () => {
  await commands.writeFile("results/chromium.figures.json", JSON.stringify(figures, null, 2));
});

for (const cell of CELLS) {
  it(`times ${cell}`, async () => {
    const [size, scenario] = cell.split("/") as [string, "live" | "settled"];
    const list = generateList({ size: Number(size), scenario });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(list.now);
    try {
      figures.chromium![cell] = await runChromium(list);
    } finally {
      vi.useRealTimers();
    }
  });
}

it("times Mark all read on the MAR list", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(markAllReadList().now);
  try {
    figures.markAllRead!.chromium = await runMarkAllReadChromium(markAllReadList);
  } finally {
    vi.useRealTimers();
  }
});
