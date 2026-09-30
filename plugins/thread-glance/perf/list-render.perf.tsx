// @vitest-environment jsdom
// `npm run perf`: the jsdom run over every generated list, the Mark all read
// list's commits, and, when PERF_THREADS names one, a real snapshot:
//   bb thread list --json --include-hidden > threads.json
//   bb project list --json > projects.json
//   PERF_THREADS=threads.json PERF_PROJECTS=projects.json npm run perf
import "./harness/render-counter";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { generateList, markAllReadList } from "@/features/thread-list/testing/fixtures";
import { CELLS, parseCell, type Figures } from "./figures";
import { runJsdom, runMarkAllRead } from "./harness/jsdom-run";
import { writeFragment } from "./harness/results";
import { snapshotList } from "./harness/snapshot";

const SAMPLES = Number(process.env.PERF_RUNS ?? 3);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("jsdom run", () => {
  it("measures every generated list and the Mark all read list", async () => {
    const figures: Partial<Figures> = { jsdom: {}, markAllRead: {} };
    for (const cell of CELLS) {
      figures.jsdom![cell] = await runJsdom(generateList(parseCell(cell)), { samples: SAMPLES });
      cleanup();
      localStorage.clear();
    }
    figures.markAllRead!.jsdom = await runMarkAllRead(markAllReadList());
    writeFragment("jsdom", figures);
  });

  it.skipIf(!process.env.PERF_THREADS)("measures a real snapshot", async () => {
    const list = snapshotList(
      JSON.parse(readFileSync(process.env.PERF_THREADS!, "utf8")),
      process.env.PERF_PROJECTS ? JSON.parse(readFileSync(process.env.PERF_PROJECTS, "utf8")) : [],
    );
    writeFragment("snapshot", { snapshot: await runJsdom(list, { samples: SAMPLES }) });
  });
});
