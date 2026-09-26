import { describe, expect, it } from "vitest";
import { failedUnread, finishedUnread, makeThread, rowIds, T0, viewOf, working } from "../testing/fixtures";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ListView, OlderRow, Row, ThreadRow } from "./view";

const rowsOf = (view: ListView, id = "project:proj_a"): Row[] => {
  const found = [...view.groups, ...view.more].find((candidate) => candidate.descriptor.id === id);
  if (found === undefined) throw new Error(`no group ${id}`);
  return found.rows;
};
const depths = (view: ListView) =>
  rowsOf(view).map((row) =>
    row.type === "thread" ? `${row.info.thread.id}@${row.depth}` : row.type === "older"
        ? `older:${row.count}@${row.depth}`
        : row.type === "left-out"
          ? `more:${row.count}@${row.depth}`
          : `env@${row.depth}`,
  );

describe("per-level folding", () => {
  // A parent with one busy child that has three reviewers under it, and four quiet children.
  const quiet = ["a", "b", "c", "d"].map((id, n) => makeThread({ id, parentThreadId: "m", createdAt: T0 + 1 + n }));
  const reviewers = ["r1", "r2", "r3"].map((id, n) =>
    makeThread({ id, parentThreadId: "fix", createdAt: T0 + 10 + n }),
  );
  const threads = [
    makeThread({ id: "m" }),
    ...quiet,
    makeThread({ id: "fix", parentThreadId: "m", createdAt: T0 + 5, ...working }),
    ...reviewers,
  ];

  it("shows the parent's direct children only, so reviewers never take their slots", () => {
    const view = viewOf({ threads, prefs: { expandedChildren: ["m"] } });
    expect(depths(view)).toEqual(["m@0", "b@1", "c@1", "d@1", "fix@1", "older:1@1"]);
    const fix = rowsOf(view).find((row): row is ThreadRow => row.type === "thread" && row.info.thread.id === "fix");
    expect(fix?.chip).toMatchObject({ count: 3, expanded: false });
  });

  it("opens a child's own level from its own chip, at the next indent", () => {
    const view = viewOf({ threads, prefs: { expandedChildren: ["m", "fix"] } });
    expect(depths(view)).toEqual(["m@0", "b@1", "c@1", "d@1", "fix@1", "r1@2", "r2@2", "r3@2", "older:1@1"]);
    expect(rowsOf(view).filter((row) => row.type === "thread").map((row) => (row as ThreadRow).nested)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("folds a level with its own fold row, on its own level", () => {
    const many = Array.from({ length: 6 }, (_, n) =>
      makeThread({ id: `s${n}`, parentThreadId: "fix", createdAt: T0 + 20 + n }),
    );
    const view = viewOf({ threads: [...threads.filter((t) => !["r1", "r2", "r3"].includes(t.id)), ...many], prefs: { expandedChildren: ["m", "fix"] } });
    expect(depths(view)).toEqual(["m@0", "b@1", "c@1", "d@1", "fix@1", "s3@2", "s4@2", "s5@2", "older:3@2", "older:1@1"]);
    const fold = rowsOf(view).find((row): row is OlderRow => row.type === "older" && row.depth === 2)!;
    expect(fold).toMatchObject({ scope: "family", scopeId: "fix" });
  });

  it("opens the level on the way to a revealed thread, keeping every ancestor and saying what it left out", () => {
    const withQuestion = [
      makeThread({ id: "m" }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2 }),
      makeThread({ id: "h", parentThreadId: "c", createdAt: T0 + 3 }),
    ];
    const view = viewOf({
      threads: withQuestion,
      prefs: { expandedChildren: ["m"] },
      targets: new Map([["g", "reveal" as const]]),
    });
    expect(depths(view)).toEqual(["m@0", "c@1", "g@2", "older:1@2"]);
    expect(rowsOf(view).find((row): row is OlderRow => row.type === "older")).toMatchObject({ scope: "reveal", scopeId: "c" });
  });

  it("shows the open grandchild's parent with it, even when nothing else is open", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "m" }),
        makeThread({ id: "c", parentThreadId: "m" }),
        makeThread({ id: "g", parentThreadId: "c" }),
      ],
      activeThreadId: "g",
      targets: new Map([["g", "reveal" as const]]),
    });
    expect(rowIds(view, "project:proj_a")).toEqual(["m", "c", "g"]);
  });
});

/** A small seeded generator, so a failure names its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a grandchild never shows without its parent (property)", () => {
  const STATES = [{}, {}, working, failedUnread, finishedUnread, { hasPendingInteraction: true }, { queuedWork: "failed" as const }];

  function forest(next: () => number): { threads: PluginSidebarThread[]; ids: string[] } {
    const size = 1 + Math.floor(next() * 28);
    const threads: PluginSidebarThread[] = [];
    for (let index = 0; index < size; index += 1) {
      const parent = index > 0 && next() < 0.8 ? threads[Math.floor(next() * index)]!.id : null;
      const state = STATES[Math.floor(next() * STATES.length)]!;
      threads.push(
        makeThread({
          id: `t${index}`,
          parentThreadId: parent,
          createdAt: T0 + index,
          updatedAt: T0 + Math.floor(next() * 40),
          latestAttentionAt: T0 + Math.floor(next() * 40),
          lastReadAt: T0 + Math.floor(next() * 40),
          isHidden: next() < 0.07,
          isArchived: next() < 0.05,
          ...state,
        }),
      );
    }
    return { threads, ids: threads.map((thread) => thread.id) };
  }

  it("holds for random forests, folds, settings, open threads, holds and reveals, and draws each thread once", () => {
    let checked = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const next = random(seed);
      const { threads, ids } = forest(next);
      const pick = () => ids.filter(() => next() < 0.3);
      const active = next() < 0.6 ? ids[Math.floor(next() * ids.length)]! : null;
      const view = viewOf({
        threads,
        activeThreadId: active,
        heldRootId: next() < 0.3 ? ids[Math.floor(next() * ids.length)]! : null,
        prefs: {
          expandedChildren: pick(),
          expandedOlder: pick(),
          childAttention: next() < 0.5 ? "blocked" : "everything",
          threadLifecycles: ["active", "archived"],
        },
        targets: new Map(pick().map((id) => [id, "reveal" as const])),
      });
      const drawn = new Set<string>();
      for (const rows of [view.attention?.rows ?? [], ...[...view.groups, ...view.more].map((group) => group.rows)]) {
        const seen: ThreadRow[] = [];
        for (const row of rows) {
          if (row.type !== "thread") continue;
          expect(drawn.has(row.info.thread.id), `seed ${seed}: ${row.info.thread.id} is drawn twice`).toBe(false);
          drawn.add(row.info.thread.id);
          if (row.depth > 0) {
            // The row above it one level up must be its parent, the same family and group.
            const above = [...seen].reverse().find((candidate) => candidate.depth < row.depth);
            expect(above?.depth, `seed ${seed}: ${row.info.thread.id} has no row one level up`).toBe(row.depth - 1);
            expect(above?.info.thread.id, `seed ${seed}: ${row.info.thread.id} sits under the wrong row`).toBe(row.info.parentId);
            checked += 1;
          }
          seen.push(row);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
