import { describe, expect, it } from "vitest";
import { makeThread, T0, viewOf, type Scenario } from "../testing/fixtures";
import { readSystemFacts } from "../sync";
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
  const config = (chosen: string | null) => ({
    primaryHostId: "host_1",
    generalSettings: { defaultProviderId: chosen },
    // How machines reach the server, never a harness.
    serverAccess: { defaultProviderId: "connect" },
  });
  const providers = [
    { id: "codex", available: false },
    { id: "claude-code", available: true },
    { id: "pi", available: true },
  ];

  it("takes the default harness the user chose while bb can start threads on it, and the primary machine", () => {
    expect(readSystemFacts(config("pi"), providers)).toEqual({ defaultProviderId: "pi", primaryHostId: "host_1" });
    expect(readSystemFacts(config("pi"))).toEqual({ defaultProviderId: "pi", primaryHostId: "host_1" });
  });

  it("with none chosen, takes the first available harness, as bb starts a thread on", () => {
    expect(readSystemFacts(config(null), providers)).toEqual({ defaultProviderId: "claude-code", primaryHostId: "host_1" });
    expect(readSystemFacts(config("codex"), providers).defaultProviderId).toBe("claude-code");
  });

  it("never takes the server access provider: with no harness known, the default is unknown", () => {
    expect(readSystemFacts(config(null)).defaultProviderId).toBeNull();
    expect(readSystemFacts(config(null), []).defaultProviderId).toBeNull();
  });
});
