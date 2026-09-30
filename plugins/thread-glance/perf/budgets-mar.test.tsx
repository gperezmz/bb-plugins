// @vitest-environment jsdom
// The ledger's deterministic rows over the Mark all read list and the plugin
// server: `npm test` fails when one is missed (perf/ledger.ts).
import "./harness/render-counter";
import { afterEach, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { generateList, markAllReadList } from "@/features/thread-list/testing/fixtures";
import { emptyFigures } from "./figures";
import { missedBudgets } from "./harness/enforce";
import { runHost } from "./harness/host-run";
import { runMarkAllRead } from "./harness/jsdom-run";
import { runServer } from "./harness/server-run";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("holds the deterministic budgets of Mark all read and the server", async () => {
  const figures = emptyFigures();
  figures.markAllRead.jsdom = await runMarkAllRead(markAllReadList());
  cleanup();
  figures.markAllRead.host = (await runHost(markAllReadList(), { markAllRead: true })).markAllRead;
  figures.server = await runServer(generateList({ size: 1_500 }).threads.map((thread) => thread.id));
  expect(missedBudgets(figures, ["deterministic", "both"])).toEqual([]);
}, 900_000);
