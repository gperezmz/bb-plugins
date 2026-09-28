import { describe, expect, it } from "vitest";
import { childAttentionFor, countsEveryChild, sortArrow, sortFieldPatch } from "./settings";

describe("the ↓/↑ button", () => {
  it("shows the direction the list is in, a saved default as the field's own", () => {
    expect(sortArrow({ chronologicalSort: "updated", sortDirection: "default" })).toMatchObject({ glyph: "↓", label: "Newest first" });
    expect(sortArrow({ chronologicalSort: "created", sortDirection: "ascending" })).toMatchObject({ glyph: "↑", label: "Oldest first" });
    expect(sortArrow({ chronologicalSort: "alpha", sortDirection: "default" })).toMatchObject({ glyph: "↑", label: "A–Z" });
    expect(sortArrow({ chronologicalSort: "alpha", sortDirection: "descending" })).toMatchObject({ glyph: "↓", label: "Z–A" });
    expect(sortArrow({ chronologicalSort: "none", sortDirection: "default" })).toMatchObject({ glyph: "↓" });
  });
  it("saves the other direction, as ascending or descending", () => {
    expect(sortArrow({ chronologicalSort: "updated", sortDirection: "default" }).patch).toEqual({ sortDirection: "ascending" });
    expect(sortArrow({ chronologicalSort: "alpha", sortDirection: "default" }).patch).toEqual({ sortDirection: "descending" });
    expect(sortArrow({ chronologicalSort: "alpha", sortDirection: "descending" }).patch).toEqual({ sortDirection: "ascending" });
  });
  it("starts a newly chosen field in its own direction", () => {
    expect(sortFieldPatch("alpha")).toEqual({ chronologicalSort: "alpha", sortDirection: "ascending" });
    expect(sortFieldPatch("created")).toEqual({ chronologicalSort: "created", sortDirection: "descending" });
  });
});

describe("Needs attention counts every child", () => {
  it("is on exactly when children count as everything", () => {
    expect(countsEveryChild("everything")).toBe(true);
    expect(countsEveryChild("blocked")).toBe(false);
    expect(childAttentionFor(true)).toBe("everything");
    expect(childAttentionFor(false)).toBe("blocked");
  });
});
