import { describe, expect, it } from "vitest";
import { failedUnread, forestOf, makeThread, T0, viewOf, working, type Scenario } from "../testing/fixtures";
import { countNeedYou, needYouActive } from "./view";

const threads = [
  makeThread({ id: "a", hasPendingInteraction: true, latestAttentionAt: T0 + 3, lastReadAt: T0 + 3 }),
  makeThread({ id: "a2", latestAttentionAt: T0 + 2, lastReadAt: T0 + 2 }),
  makeThread({ id: "ac", parentThreadId: "a2", createdAt: T0 + 1, ...failedUnread }),
  makeThread({ id: "quiet" }),
  makeThread({ id: "b", projectId: "proj_b", ...working }),
  makeThread({ id: "hidden", projectId: "proj_b", hasPendingInteraction: true }),
  makeThread({ id: "p", pinnedAt: T0, isPinned: true }),
];

function drawn(scenario: Scenario): Record<string, string[]> {
  const view = viewOf(scenario);
  return Object.fromEntries(
    view.groups.map((group) => [group.descriptor.id, group.rows.flatMap((row) => (row.type === "thread" ? [row.info.thread.id] : []))]),
  );
}

describe("the need-you filter", () => {
  it("counts the thread trees that need attention, in hidden groups too", () => {
    expect(viewOf({ threads }).needYouCount).toBe(3);
    expect(viewOf({ threads, prefs: { hiddenGroups: ["project:proj_b"] } }).needYouCount).toBe(3);
    expect(viewOf({ threads: [makeThread({ id: "x" })] }).needYouCount).toBe(0);
  });

  it("leaves only those trees, each under its own group's header, hidden groups included", () => {
    const prefs = { hiddenGroups: ["project:proj_b"], collapsedProjects: ["proj_a"], openSettledFolds: ["project:proj_a"] };
    const on = viewOf({ threads, prefs, needYouOnly: true });
    expect(drawn({ threads, prefs, needYouOnly: true })).toEqual({ "project:proj_a": ["a2", "a"], "project:proj_b": ["hidden"] });
    expect(on.more).toEqual([]);
    expect(on.groups.every((group) => !group.collapsed)).toBe(true);
    // Its settled fold stays out, and trees that need attention never settle.
    expect(on.groups.flatMap((group) => group.rows).some((row) => row.type === "settled")).toBe(false);
  });

  it("stops narrowing the list once nothing needs you", () => {
    expect(needYouActive(true, 2)).toBe(true);
    expect(needYouActive(true, 0)).toBe(false);
    expect(needYouActive(false, 2)).toBe(false);
    const calm = threads.map((thread) => ({ ...thread, hasPendingInteraction: false, status: "idle" as const, lastReadAt: T0 + 100 }));
    expect(countNeedYou(forestOf({ threads: calm }))).toBe(0);
  });

  it("restores the full list when off", () => {
    expect(drawn({ threads })).toMatchObject({ pinned: ["p"], "project:proj_a": ["a2", "a", "quiet"], "project:proj_b": ["b", "hidden"] });
  });
});
