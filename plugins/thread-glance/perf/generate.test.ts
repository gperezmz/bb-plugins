// The generated lists the harness measures: the audit's shape, from a seed.
import { describe, expect, it } from "vitest";
import { generateList, markAllReadList, viewOf, type GeneratedScenario } from "@/features/thread-list/testing/fixtures";

describe("generateList", () => {
  it.each([50, 300, 1_500])("gives %i threads in the audit's shape", (size) => {
    const { threads, projects } = generateList({ size });
    const roots = threads.filter((thread) => thread.parentThreadId === null);
    const children = threads.length - roots.length;
    const parents = new Set(threads.flatMap((thread) => thread.parentThreadId ?? []));
    expect(threads).toHaveLength(size);
    expect(roots.length).toBe(Math.round((size * 2) / 3));
    expect(Math.ceil(children / 5)).toBe(parents.size);
    expect(new Set(threads.map((thread) => thread.projectId))).toEqual(new Set(projects.map((project) => project.id)));
    expect(projects).toHaveLength(4);
    expect(threads.filter((thread) => thread.isUnread).length).toBe(Math.round(size * 0.05));
  });

  it("gives the same list for the same seed, and another for another", () => {
    expect(generateList({ size: 300 })).toEqual(generateList({ size: 300 }));
    expect(generateList({ size: 300, seed: 1 }).unreadIds).not.toEqual(generateList({ size: 300 }).unreadIds);
  });

  it("settles nothing live, and every read tree two days on", () => {
    const settledRows = (scenario: GeneratedScenario) => {
      const { threads, projects, now } = generateList({ size: 300, scenario });
      const view = viewOf({ threads, projects, now });
      return view.groups.flatMap((group) => group.rows.filter((row) => row.type === "settled"));
    };
    expect(settledRows("live")).toEqual([]);
    expect(settledRows("settled")).toHaveLength(4);
  });

  it("gives the Mark all read list 1,500 threads, 443 unread", () => {
    const { threads, unreadIds } = markAllReadList();
    expect(threads).toHaveLength(1_500);
    expect(unreadIds).toHaveLength(443);
  });
});
