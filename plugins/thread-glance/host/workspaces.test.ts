import { describe, expect, it } from "vitest";
import { matchWorkspace, workspaceMatchers } from "./workspaces";

const same = (path: string) => path;

describe("matchWorkspace", () => {
  const matchers = workspaceMatchers(["/work/app", "/work/app/packages/web", "/work/app2"], same);

  it("picks the longest path on a path boundary", () => {
    expect(matchWorkspace("/work/app/packages/web/src", matchers)).toBe("/work/app/packages/web");
    expect(matchWorkspace("/work/app/packages/api", matchers)).toBe("/work/app");
    expect(matchWorkspace("/work/app", matchers)).toBe("/work/app");
    expect(matchWorkspace("/work/app2/x", matchers)).toBe("/work/app2");
  });

  it("does not match a longer name that shares a prefix, or an outside directory", () => {
    expect(matchWorkspace("/work/application", workspaceMatchers(["/work/app"], same))).toBeNull();
    expect(matchWorkspace("/tmp", matchers)).toBeNull();
    expect(matchWorkspace("/", matchers)).toBeNull();
  });

  it("matches the real path too and returns the workspace as it was given", () => {
    const linked = workspaceMatchers(["/home/me/link/"], (path) => (path === "/home/me/link/" ? "/data/real" : null));
    expect(matchWorkspace("/data/real/src", linked)).toBe("/home/me/link/");
    expect(matchWorkspace("/home/me/link/src", linked)).toBe("/home/me/link/");
  });

  it("ignores a relative path and the root", () => {
    expect(workspaceMatchers(["relative", "/", ""], same)).toEqual([]);
  });
});
