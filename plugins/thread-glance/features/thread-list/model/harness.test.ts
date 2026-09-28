import { describe, expect, it } from "vitest";
import { makeThread, T0, viewOf, type Scenario } from "../testing/fixtures";
import { readSystemFacts } from "../data/useSystemFacts";
import type { ThreadRow } from "./view";

function harnessOf(scenario: Scenario): Record<string, boolean> {
  const rows = [...viewOf(scenario).groups, ...viewOf(scenario).more].flatMap((group) => group.rows);
  return Object.fromEntries(
    rows.filter((row): row is ThreadRow => row.type === "thread").map((row) => [row.info.thread.id, row.harness]),
  );
}

describe("the harness icon", () => {
  const tree = [
    makeThread({ id: "r", providerId: "claude-code" }),
    makeThread({ id: "same", parentThreadId: "r", providerId: "claude-code", createdAt: T0 + 1 }),
    makeThread({ id: "other", parentThreadId: "r", providerId: "codex", createdAt: T0 + 2 }),
    makeThread({ id: "deep-same", parentThreadId: "other", providerId: "codex", createdAt: T0 + 3 }),
    makeThread({ id: "deep-other", parentThreadId: "other", providerId: "pi", createdAt: T0 + 4 }),
    makeThread({ id: "odd-root", providerId: "codex", createdAt: T0 + 5 }),
  ];
  const open = { expandedChildren: ["r", "other"] };

  it("draws on a root exactly when its harness is not bb's default", () => {
    expect(harnessOf({ threads: tree, prefs: open })).toMatchObject({ r: false, "odd-root": true });
    expect(harnessOf({ threads: tree, prefs: open, defaultProviderId: "codex" })).toMatchObject({ r: true, "odd-root": false });
  });

  it("draws on a child exactly when its harness is not its parent thread's, at every depth", () => {
    expect(harnessOf({ threads: tree, prefs: open })).toMatchObject({ same: false, other: true, "deep-same": false, "deep-other": true });
  });

  it("draws on no root while bb's default harness is unknown", () => {
    expect(harnessOf({ threads: tree, prefs: open, defaultProviderId: null })).toMatchObject({ r: false, "odd-root": false, other: true });
  });
});

describe("bb's system facts", () => {
  it("takes the default harness the user chose, else the one bb falls back to, and the primary machine", () => {
    const config = (chosen: string | null) => ({
      primaryHostId: "host_1",
      generalSettings: { defaultProviderId: chosen },
      serverAccess: { defaultProviderId: "codex" },
    });
    expect(readSystemFacts(config("claude-code"))).toEqual({ defaultProviderId: "claude-code", primaryHostId: "host_1" });
    expect(readSystemFacts(config(null))).toEqual({ defaultProviderId: "codex", primaryHostId: "host_1" });
  });
});
