import { describe, expect, it } from "vitest";
import { makeProject, makeThread, PROJECTS } from "@/testing/fixtures";
import { ALL_PROJECTS, filterScopeOptions, inScope, moveHighlight, projectsNeedingYou, resolveScope, scopeButtonLabel, scopeLabel, scopeOptions, toggleProject } from "./scope";

describe("the project scope", () => {
  it("lists All projects, then every project including the personal one, by name", () => {
    expect(scopeOptions(PROJECTS).map((option) => option.name)).toEqual(["All projects", "Alpha", "Beta", "Personal"]);
  });

  it("adds a project to the scope, takes it out again, and is All projects once the last one is out", () => {
    expect(toggleProject([], "proj_a")).toEqual(["proj_a"]);
    expect(toggleProject(["proj_a"], "proj_b")).toEqual(["proj_a", "proj_b"]);
    expect(toggleProject(["proj_a", "proj_b"], "proj_a")).toEqual(["proj_b"]);
    expect(toggleProject(["proj_b"], "proj_b")).toEqual([]);
  });

  it("holds every project in All projects and only its own in a scope", () => {
    expect(inScope([], "proj_a")).toBe(true);
    expect(inScope(["proj_a", "proj_b"], "proj_b")).toBe(true);
    expect(inScope(["proj_a", "proj_b"], "proj_c")).toBe(false);
  });

  it("drops the projects that are gone once the projects are listed, and is All projects when none is left", () => {
    const scope = ["proj_a", "proj_zzz"];
    expect(resolveScope(scope, PROJECTS, true)).toEqual(["proj_a"]);
    expect(resolveScope(["proj_zzz"], PROJECTS, true)).toEqual([]);
    const intact = ["proj_a", "proj_b"];
    expect(resolveScope(intact, PROJECTS, true)).toBe(intact);
  });

  it("keeps every project while the projects are not listed yet", () => {
    const scope = ["proj_a", "proj_zzz"];
    expect(resolveScope(scope, [], false)).toBe(scope);
  });

  it("names the scope by its projects in name order", () => {
    expect(scopeLabel([], PROJECTS)).toBe(ALL_PROJECTS.name);
    expect(scopeLabel(["proj_b", "proj_a"], PROJECTS)).toBe("Alpha, Beta");
    expect(scopeLabel(["proj_zzz"], PROJECTS)).toBe(ALL_PROJECTS.name);
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

describe("the projects a scope leaves out that need you", () => {
  const threads = [
    makeThread({ id: "a1", projectId: "proj_a", hasPendingInteraction: true }),
    makeThread({ id: "b1", projectId: "proj_b", hasPendingInteraction: true }),
    makeThread({ id: "b2", projectId: "proj_b", hasPendingInteraction: true }),
    makeThread({ id: "p1", projectId: "proj_personal", hasPendingInteraction: false }),
  ];

  it("lists the left-out projects with a waiting thread, once each", () => {
    expect(projectsNeedingYou(["proj_personal"], threads)).toEqual(["proj_a", "proj_b"]);
    expect(projectsNeedingYou(["proj_a"], threads)).toEqual(["proj_b"]);
  });

  it("lists none for a project in the scope, a project without a waiting thread, or All projects", () => {
    expect(projectsNeedingYou(["proj_a", "proj_b"], threads)).toEqual([]);
    expect(projectsNeedingYou([], threads)).toEqual([]);
    expect(projectsNeedingYou(["proj_a"], threads.filter((thread) => thread.projectId !== "proj_b"))).toEqual([]);
  });

  it("names them on the button, after the scope", () => {
    expect(scopeButtonLabel(["proj_personal"], PROJECTS, [])).toBe("Project scope: Personal");
    expect(scopeButtonLabel(["proj_personal"], PROJECTS, ["proj_a", "proj_b"])).toBe("Project scope: Personal. Needs you in Alpha, Beta");
  });
});
