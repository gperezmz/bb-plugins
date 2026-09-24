import { describe, expect, it } from "vitest";
import { deriveItems } from "./items.js";
import { parseManifest } from "./manifest.js";
import type { ItemDef, ItemResult, Status } from "./model.js";
import {
  aggregateStatus,
  badgeFor,
  buildItemViews,
  doneSummary,
  homeLine,
  nextStep,
  progress,
  resolveScope,
  resultKey,
  statusFromOutcome,
  type Machine,
} from "./status.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const server: Machine = { id: "h-server", name: "server", isServer: true, online: true, persistent: true, lastSeenAt: null };
const remote: Machine = { id: "h-remote", name: "laptop", isServer: false, online: true, persistent: true, lastSeenAt: null };
const ephemeral: Machine = { id: "h-eph", name: "sandbox", isServer: false, online: true, persistent: false, lastSeenAt: null };

function item(id: string, extra: Partial<ItemDef> = {}): ItemDef {
  return {
    id,
    group: "tools",
    title: id,
    why: "",
    required: true,
    scope: "all",
    check: { kind: "env", name: id },
    estimate: "~1 min",
    commands: [],
    ...extra,
  };
}

function result(itemId: string, hostId: string, status: Status, facts: ItemResult["facts"] = {}): ItemResult {
  return { itemId, hostId, status, category: status, checkedAt: new Date(NOW).toISOString(), detail: status, facts };
}

function stored(...results: ItemResult[]) {
  return new Map(results.map((r) => [resultKey(r.itemId, r.hostId), r]));
}

describe("statusFromOutcome", () => {
  it("is todo before an item ever passed and broken after", () => {
    expect(statusFromOutcome("fail", false)).toBe("todo");
    expect(statusFromOutcome("fail", true)).toBe("broken");
    expect(statusFromOutcome("error", true)).toBe("unknown");
  });
});

describe("aggregateStatus", () => {
  it("takes the worst over online in-scope machines; unknown and skipped never fail", () => {
    expect(aggregateStatus(["ok", "broken", "update"])).toBe("broken");
    expect(aggregateStatus(["ok", "unknown"])).toBe("ok");
    expect(aggregateStatus(["unknown", "skipped"])).toBe("unknown");
    expect(aggregateStatus(["skipped"])).toBe("skipped");
    expect(aggregateStatus(["update", "needs-approval", "todo"])).toBe("needs-approval");
  });
});

describe("resolveScope", () => {
  it("maps all to persistent machines and names to machines", () => {
    expect(resolveScope("all", [server, remote, ephemeral]).map((m) => m.id)).toEqual(["h-server", "h-remote"]);
    expect(resolveScope("server", [server, remote]).map((m) => m.id)).toEqual(["h-server"]);
    expect(resolveScope(["laptop"], [server, remote]).map((m) => m.id)).toEqual(["h-remote"]);
  });
});

describe("item views", () => {
  // Acceptance 19: an item scoped to machine A shows skipped on B and isn't counted.
  it("skips out-of-scope machines and doesn't count them", () => {
    const items = [item("tool:a", { scope: ["server"] })];
    const views = buildItemViews(items, [server, remote], stored(result("tool:a", "h-server", "ok")), NOW);
    expect(views[0]!.results.find((r) => r.hostId === "h-remote")!.status).toBe("skipped");
    expect(views[0]!.status).toBe("ok");
    expect(badgeFor(views)).toEqual({ kind: "done" });
  });

  // Acceptance 10: an offline machine's chips are unknown with its name; the badge ignores them.
  it("turns an offline machine unknown and keeps it out of the badge", () => {
    const offline = { ...remote, online: false, lastSeenAt: new Date(NOW - 2 * 3600_000).toISOString() };
    const items = [item("tool:a")];
    const views = buildItemViews(items, [server, offline], stored(result("tool:a", "h-server", "ok"), result("tool:a", "h-remote", "broken")), NOW);
    const chip = views[0]!.results.find((r) => r.hostId === "h-remote")!;
    expect(chip.status).toBe("unknown");
    expect(chip.detail).toContain("laptop");
    expect(views[0]!.status).toBe("ok");
    expect(badgeFor(views)).toEqual({ kind: "done" });
  });

  it("skips a machine offline for over a week", () => {
    const gone = { ...remote, online: false, lastSeenAt: new Date(NOW - 8 * 86_400_000).toISOString() };
    const views = buildItemViews([item("tool:a")], [server, gone], stored(), NOW);
    expect(views[0]!.results.find((r) => r.hostId === "h-remote")!.category).toBe("long-offline");
  });

  it("starts fresh items as todo", () => {
    const views = buildItemViews([item("tool:a")], [server], stored(), NOW);
    expect(views[0]!.status).toBe("todo");
  });
});

describe("badge, next step, progress and home line", () => {
  // Acceptance 1: a fresh server shows grey todo rows; the badge counts the core items.
  it("counts core items on a fresh server with no manifest", () => {
    const items = deriveItems(null, { knownProviders: [{ id: "claude-code", displayName: "Claude Code" }] });
    const views = buildItemViews(items, [server], stored(), NOW);
    expect(views.every((view) => view.status === "todo")).toBe(true);
    const required = items.filter((i) => i.required).length;
    expect(badgeFor(views)).toEqual({ kind: "count", count: required });
    expect(nextStep(views)?.item.id).toBe("github.gh-installed");
  });

  it("orders the next step: GitHub login, manifest, skills, agents, then the rest", () => {
    const parsed = parseManifest(
      [
        "schema: 1",
        "team: { name: T }",
        "providers: [{ id: claude-code }]",
        "skills: [{ id: s, source: git, url: 'https://example.com/s.git' }]",
        "tools: [{ id: gh, check: { bin: gh } }]",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error("bad fixture");
    const items = deriveItems(parsed.manifest, { knownProviders: [] });
    const ok = (id: string) => result(id, "h-server", "ok");
    const base = ["github.gh-installed", "github.login", "github.builtin-git", "core.manifest"];
    let views = buildItemViews(items, [server], stored(...base.map(ok)), NOW);
    expect(nextStep(views)?.item.id).toBe("skill:s");
    views = buildItemViews(items, [server], stored(...[...base, "skill:s"].map(ok)), NOW);
    expect(nextStep(views)?.item.id).toBe("agent:claude-code");
    views = buildItemViews(items, [server], stored(...[...base, "skill:s", "agent:claude-code"].map(ok)), NOW);
    expect(nextStep(views)?.item.id).toBe("tool:gh");
  });

  // Acceptance 15: only an update remains: dot badge and "1 update available".
  it("shows a dot and the update line when only updates remain", () => {
    const views = buildItemViews([item("a"), item("b")], [server], stored(result("a", "h-server", "ok"), result("b", "h-server", "update")), NOW);
    expect(badgeFor(views)).toEqual({ kind: "dot", updates: 1 });
    expect(homeLine(views, null, NOW)).toBe("1 update available");
  });

  // Acceptance 26: everything passes: all set, check mark, and the done summary.
  it("reads All set when every required item passes", () => {
    const skills = item("skill:s", { group: "skills" });
    const agent = item("agent:claude-code", { group: "agents", title: "Claude Code" });
    const views = buildItemViews(
      [skills, agent, item("opt", { required: false })],
      [server, remote],
      stored(
        result("skill:s", "h-server", "ok", { skillCount: 3 }),
        result("skill:s", "h-remote", "ok"),
        result("agent:claude-code", "h-server", "ok"),
        result("agent:claude-code", "h-remote", "ok"),
        result("opt", "h-server", "todo"),
      ),
      NOW,
    );
    expect(badgeFor(views)).toEqual({ kind: "done" });
    expect(homeLine(views, new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("All set · checked 5 min ago");
    expect(doneSummary(views, [server, remote])).toBe("3 team skills, Claude Code on 2 machines");
    expect(progress(views)).toEqual({ done: 2, total: 2 });
  });

  it("counts needs-approval as blocking", () => {
    const views = buildItemViews([item("a")], [server], stored(result("a", "h-server", "needs-approval")), NOW);
    expect(homeLine(views, null, NOW)).toBe("1 setup step left");
  });
});
