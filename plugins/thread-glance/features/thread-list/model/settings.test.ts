import { describe, expect, it } from "vitest";
import { lifecyclesFor, sortArrow, sortFieldPatch, threadsShown } from "./settings";

describe("Threads: Active, Archived, Both", () => {
  it("reads every saved lifecycle list as one choice", () => {
    expect(threadsShown(["active"])).toBe("active");
    expect(threadsShown(["archived"])).toBe("archived");
    expect(threadsShown(["active", "archived"])).toBe("both");
    expect(threadsShown(["archived", "active"])).toBe("both");
  });
  it("saves at least one lifecycle for every choice", () => {
    expect(lifecyclesFor("active")).toEqual(["active"]);
    expect(lifecyclesFor("archived")).toEqual(["archived"]);
    expect(lifecyclesFor("both")).toEqual(["active", "archived"]);
  });
});

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
