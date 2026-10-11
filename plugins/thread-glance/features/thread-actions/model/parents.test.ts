// The Parent… dialog's options (AC21).
import { describe, expect, it } from "vitest";
import { makeThread } from "@/testing/fixtures";
import { NO_PARENT_LABEL, parentOptions, unpinsOnChoice, type ParentThread } from "./parents";

const NAMES = new Map([
  ["proj_a", "Alpha"],
  ["proj_b", "Beta"],
]);
const labels = (options: ReturnType<typeof parentOptions>) => options.map((option) => option.label);

function options(thread: ParentThread, threads: ParentThread[], extra: Partial<Parameters<typeof parentOptions>[0]> = {}) {
  return parentOptions({ thread, threads, currentParent: null, projectNames: NAMES, query: "", ...extra });
}

describe("parent options", () => {
  const subject = makeThread({ id: "me", title: "Me" });

  it("lists None first, even with a search that matches nothing", () => {
    const threads = [subject, makeThread({ id: "x", title: "Other" })];
    expect(options(subject, threads)[0]).toEqual({ id: null, label: NO_PARENT_LABEL, checked: true });
    expect(labels(options(subject, threads, { query: "zzz" }))).toEqual([NO_PARENT_LABEL]);
  });

  it("leaves out the thread and its descendants, archived threads and hidden helpers", () => {
    const threads = [
      subject,
      makeThread({ id: "child", title: "Child", parentThreadId: "me" }),
      makeThread({ id: "grandchild", title: "Grandchild", parentThreadId: "child" }),
      makeThread({ id: "archived", title: "Archived", isArchived: true, archivedAt: 1 }),
      makeThread({ id: "helper", title: "Helper", isHidden: true }),
      makeThread({ id: "ok", title: "Fine" }),
    ];
    expect(labels(options(subject, threads))).toEqual([NO_PARENT_LABEL, "Fine"]);
  });

  it("keeps the current parent, checked, even when it is archived", () => {
    const thread = makeThread({ id: "me", title: "Me", parentThreadId: "old" });
    const archived = makeThread({ id: "old", title: "Old parent", isArchived: true, archivedAt: 1 });
    const fromList = options(thread, [thread, archived]);
    expect(fromList.find((option) => option.id === "old")).toEqual({ id: "old", label: "Old parent", checked: true });
    expect(fromList[0]!.checked).toBe(false);
    const fetched = options(thread, [thread], { currentParent: archived });
    expect(fetched.find((option) => option.id === "old")?.checked).toBe(true);
  });

  it("puts the thread's own project first, then recent activity, and labels other projects 'Project · Title'", () => {
    const threads = [
      subject,
      makeThread({ id: "a-old", title: "Old", updatedAt: 100, latestAttentionAt: 100, createdAt: 100 }),
      makeThread({ id: "b-new", title: "Elsewhere", projectId: "proj_b", updatedAt: 900, latestAttentionAt: 900, createdAt: 900 }),
      makeThread({ id: "a-new", title: "New", updatedAt: 500, latestAttentionAt: 500, createdAt: 500 }),
    ];
    expect(labels(options(subject, threads))).toEqual([NO_PARENT_LABEL, "New", "Old", "Beta · Elsewhere"]);
  });

  it("filters by the search over the label, project included", () => {
    const threads = [subject, makeThread({ id: "x", title: "Fix login" }), makeThread({ id: "y", title: "Docs", projectId: "proj_b" })];
    expect(labels(options(subject, threads, { query: "beta" }))).toEqual([NO_PARENT_LABEL, "Beta · Docs"]);
    expect(labels(options(subject, threads, { query: "LOGIN" }))).toEqual([NO_PARENT_LABEL, "Fix login"]);
  });
});

describe("what choosing does to a pin", () => {
  it("unpins a pinned thread when a parent is chosen, and keeps the pin for None", () => {
    expect(unpinsOnChoice(true, "p")).toBe(true);
    expect(unpinsOnChoice(true, null)).toBe(false);
    expect(unpinsOnChoice(false, "p")).toBe(false);
  });
});
