// @vitest-environment jsdom
// `npm run perf`: the fake host's request and hook counts over every
// generated list and the Mark all read list.
import "./harness/render-counter";
import { afterEach, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { generateList, markAllReadList } from "@/features/thread-list/testing/fixtures";
import { CELLS, type Figures } from "./figures";
import { runHost } from "./harness/host-run";
import { writeFragment } from "./harness/results";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("counts requests and hooks on every generated list", async () => {
  const figures: Partial<Figures> = { host: {}, markAllRead: {} };
  for (const cell of CELLS) {
    const [size, scenario] = cell.split("/") as [string, "live" | "settled"];
    figures.host![cell] = await runHost(generateList({ size: Number(size), scenario }));
    cleanup();
  }
  figures.markAllRead!.host = (await runHost(markAllReadList(), { markAllRead: true })).markAllRead;
  writeFragment("host", figures);
});
