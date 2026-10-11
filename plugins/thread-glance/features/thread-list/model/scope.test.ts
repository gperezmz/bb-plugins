import { describe, expect, it } from "vitest";
import { makeProject, PROJECTS } from "../testing/fixtures";
import { ALL_PROJECTS, filterScopeOptions, moveHighlight, resolveScope, scopeLabel, scopeOptions } from "./scope";

describe("the project scope", () => {
  it("lists All projects, then every project including the personal one, by name", () => {
    expect(scopeOptions(PROJECTS).map((option) => option.name)).toEqual(["All projects", "Alpha", "Beta", "Personal"]);
  });
  it("falls back to All projects when the project is gone", () => {
    expect(resolveScope("proj_a", PROJECTS)).toBe("proj_a");
    expect(resolveScope("proj_zzz", PROJECTS)).toBeNull();
    expect(resolveScope(null, PROJECTS)).toBeNull();
    expect(scopeLabel("proj_zzz", PROJECTS)).toBe(ALL_PROJECTS.name);
  });
  it("filters by name, ignoring case", () => {
    const options = scopeOptions([...PROJECTS, makeProject("g", "Gamma")]);
    expect(filterScopeOptions(options, "  GAM ").map((option) => option.name)).toEqual(["Gamma"]);
    expect(filterScopeOptions(options, "")).toHaveLength(5);
  });
  it("moves the highlight with wrapping arrows, Home and End", () => {
    expect(moveHighlight(-1, "ArrowDown", 3)).toBe(0);
    expect(moveHighlight(2, "ArrowDown", 3)).toBe(0);
    expect(moveHighlight(0, "ArrowUp", 3)).toBe(2);
    expect(moveHighlight(-1, "ArrowUp", 3)).toBe(2);
    expect(moveHighlight(1, "Home", 3)).toBe(0);
    expect(moveHighlight(1, "End", 3)).toBe(2);
    expect(moveHighlight(0, "End", 0)).toBe(-1);
  });
});
