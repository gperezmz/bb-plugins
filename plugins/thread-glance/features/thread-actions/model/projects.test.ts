// The Project ▸ dialogs' field rules (AC22).
import { describe, expect, it } from "vitest";
import { confirmsRemoval, localPathError, MAX_LOCAL_PATH_LENGTH, MAX_PROJECT_NAME_LENGTH, projectNameError } from "./projects";

describe("project fields", () => {
  it("accepts a project name up to 500 characters and refuses an empty or longer one", () => {
    expect(projectNameError("a".repeat(MAX_PROJECT_NAME_LENGTH))).toBeNull();
    expect(projectNameError("a".repeat(MAX_PROJECT_NAME_LENGTH + 1))).toBe("Use at most 500 characters.");
    expect(projectNameError("   ")).toBe("Enter a name.");
  });

  it("accepts a folder up to 4,096 characters and refuses an empty or longer one", () => {
    expect(localPathError("/".padEnd(MAX_LOCAL_PATH_LENGTH, "a"))).toBeNull();
    expect(localPathError("/".padEnd(MAX_LOCAL_PATH_LENGTH + 1, "a"))).toBe("Use at most 4,096 characters.");
    expect(localPathError("")).toBe("Enter a folder.");
  });

  it("confirms a removal only for the exact name", () => {
    expect(confirmsRemoval("Alpha", "Alpha")).toBe(true);
    expect(confirmsRemoval("alpha", "Alpha")).toBe(false);
    expect(confirmsRemoval("Alpha ", "Alpha")).toBe(false);
    expect(confirmsRemoval("", "Alpha")).toBe(false);
  });
});
