import { describe, expect, it } from "vitest";
import { catchUp, credentialRefused, decideHolder, DEFAULT_INTERVAL_MS, effectiveInterval, isDue, MIN_INTERVAL_MS, validateInterval, validateRegistration, type RegisterArgs } from "./registration";

const args = (over: Partial<RegisterArgs> = {}): RegisterArgs => ({
  contract: 1,
  repo: "GitHub.com/org/repo",
  tracker: "forge-issues",
  manifest: "/home/me/fleet/manifest.md",
  operator: "Operator",
  labelSpec: "spec",
  labelReady: "ready",
  labelInProgress: "in progress",
  labelNeedsInput: "needs input",
  marker: "🤖 unattendish agent",
  echoActors: [],
  ...over,
});
const reason = (over: Partial<RegisterArgs>): string => {
  const result = validateRegistration(args(over));
  if (result.outcome !== "invalid") throw new Error(`expected invalid, got ${result.outcome}`);
  return result.reason;
};

describe("validateRegistration", () => {
  it("accepts a good registration, with the parsed repo and tracker and trimmed text", () => {
    expect(validateRegistration(args({ tracker: "linear:eng", marker: " 🤖 unattendish agent ", echoActors: ["bot", "BOT", " other "] }))).toEqual({
      outcome: "valid",
      fields: {
        repo: { host: "github.com", path: "org/repo" },
        tracker: { kind: "linear", team: "ENG" },
        manifestPath: "/home/me/fleet/manifest.md",
        operator: "Operator",
        labels: { spec: "spec", ready: "ready", inProgress: "in progress", needsInput: "needs input" },
        marker: "🤖 unattendish agent",
        echoActors: ["bot", "other"],
        contract: 1,
      },
    });
  });

  it("answers unsupported for another contract and checks nothing else", () => {
    expect(validateRegistration(args({ contract: 2, repo: "nonsense" }))).toEqual({ outcome: "unsupported", supported: [1] });
    expect(validateRegistration(args({ contract: 0 }))).toEqual({ outcome: "unsupported", supported: [1] });
  });

  it("names the argument that is wrong", () => {
    expect(reason({ repo: "https://github.com/o/r" })).toContain("--repo");
    expect(reason({ tracker: "github" })).toContain("--tracker");
    expect(reason({ manifest: "fleet/manifest.md" })).toContain("--manifest");
    expect(reason({ operator: "  " })).toContain("--operator");
    expect(reason({ marker: "" })).toContain("--marker");
    expect(reason({ labelSpec: " " })).toContain("--label-spec");
    expect(reason({ labelReady: "" })).toContain("--label-ready");
    expect(reason({ labelInProgress: "" })).toContain("--label-in-progress");
    expect(reason({ labelNeedsInput: "" })).toContain("--label-needs-input");
  });

  it("takes an absolute POSIX or Windows drive path as the manifest", () => {
    for (const manifest of ["/a/b.md", "C:\\fleet\\manifest.md", "d:/fleet/manifest.md"]) expect(validateRegistration(args({ manifest })).outcome).toBe("valid");
    for (const manifest of ["", "./a.md", "~/a.md", "C:fleet.md", "\\\\server\\share"]) expect(validateRegistration(args({ manifest })).outcome).toBe("invalid");
  });

  it("refuses labels that are not pairwise distinct, whatever their case", () => {
    expect(reason({ labelReady: "SPEC" })).toBe("--label-ready equals --label-spec: the four labels must differ");
    expect(reason({ labelNeedsInput: "In Progress" })).toContain("--label-needs-input equals --label-in-progress");
  });

  it("refuses an echo actor equal to the operator, whatever its case, and says why", () => {
    const text = reason({ echoActors: ["bot", "OPERATOR"] });
    expect(text).toContain("--echo-actor equals --operator");
    expect(text).toContain("dropped as an echo");
  });

  it("refuses an empty echo actor", () => {
    expect(reason({ echoActors: [" "] })).toContain("--echo-actor");
  });

  it("refuses a control character or line break in a text argument", () => {
    expect(reason({ marker: "a\nb" })).toContain("--marker");
    expect(reason({ labelSpec: "sp\u0000ec" })).toContain("--label-spec");
    expect(reason({ operator: "op\r" })).toContain("--operator");
    expect(reason({ echoActors: ["a\nb"] })).toContain("--echo-actor");
  });
});

describe("decideHolder", () => {
  it("registers when nothing holds the repository", () => {
    expect(decideHolder(null, "t2", null)).toEqual({ action: "register" });
  });
  it("updates when the same thread registers again", () => {
    expect(decideHolder({ managerThreadId: "t1" }, "t1", null)).toEqual({ action: "update" });
    expect(decideHolder({ managerThreadId: "t1" }, "t1", "live")).toEqual({ action: "update" });
  });
  it("lets a successor take over from an archived or gone holder", () => {
    for (const holder of ["archived", "gone"] as const) expect(decideHolder({ managerThreadId: "t1" }, "t2", holder)).toEqual({ action: "take-over", previousManager: "t1" });
  });
  it("refuses a live holder, and a holder whose state is unknown", () => {
    expect(decideHolder({ managerThreadId: "t1" }, "t2", "live")).toEqual({ action: "refuse", holder: "t1" });
    expect(decideHolder({ managerThreadId: "t1" }, "t2", null)).toEqual({ action: "refuse", holder: "t1" });
  });
});

describe("intervals", () => {
  it("has a two-minute default and a 30-second floor", () => {
    expect(DEFAULT_INTERVAL_MS).toBe(120_000);
    expect(MIN_INTERVAL_MS).toBe(30_000);
    expect(effectiveInterval({ intervalMs: null })).toBe(120_000);
    expect(effectiveInterval({ intervalMs: 45_000 })).toBe(45_000);
  });
  it("refuses an interval under the floor, naming it", () => {
    const result = validateInterval(10_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("30-second floor");
    expect(validateInterval(29_999).ok).toBe(false);
  });
  it("accepts the floor and above, and refuses what is not a whole number", () => {
    expect(validateInterval(30_000)).toEqual({ ok: true });
    expect(validateInterval(3_600_000)).toEqual({ ok: true });
    for (const ms of [Number.NaN, Infinity, 45_000.5]) expect(validateInterval(ms).ok).toBe(false);
  });
});

describe("isDue", () => {
  it("is due when never polled, or when the interval has passed", () => {
    expect(isDue(null, "2026-10-12T10:00:00.000Z", 120_000)).toBe(true);
    expect(isDue("2026-10-12T09:58:00.000Z", "2026-10-12T10:00:00.000Z", 120_000)).toBe(true);
    expect(isDue("2026-10-12T09:58:01.000Z", "2026-10-12T10:00:00.000Z", 120_000)).toBe(false);
  });
  it("is due when a time cannot be read", () => {
    expect(isDue("garbage", "2026-10-12T10:00:00.000Z", 120_000)).toBe(true);
  });
});

describe("catchUp", () => {
  const last = "2026-10-12T10:00:00.000Z";
  const after = (ms: number) => new Date(Date.parse(last) + ms).toISOString();
  it("is the gap when the plugin was away for more than three intervals and ten minutes", () => {
    expect(catchUp(last, after(8 * 3_600_000), 120_000)).toBe(8 * 3_600_000);
  });
  it("is null for an ordinary gap, and at the threshold itself", () => {
    expect(catchUp(last, after(150_000), 120_000)).toBeNull();
    expect(catchUp(last, after(600_000), 120_000)).toBeNull();
    expect(catchUp(last, after(600_001), 120_000)).toBe(600_001);
  });
  it("scales with the interval: three long intervals are not an absence", () => {
    expect(catchUp(last, after(3_600_000), 1_200_000)).toBeNull();
    expect(catchUp(last, after(3_600_001), 1_200_000)).toBe(3_600_001);
  });
  it("is null for a fleet never polled, and for times that cannot be read", () => {
    expect(catchUp(null, after(10 * 3_600_000), 120_000)).toBeNull();
    expect(catchUp("not a time", after(10 * 3_600_000), 120_000)).toBeNull();
  });
});

describe("credentialRefused", () => {
  it("names the prefix whose credential the service refused", () => {
    expect(credentialRefused("github.com/org")).toEqual({ code: "credential-refused", text: "The credential for github.com/org was refused by the service" });
  });
});
