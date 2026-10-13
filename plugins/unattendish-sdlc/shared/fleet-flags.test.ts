import { describe, expect, it } from "vitest";
import { ago, fleetCard, MINUTE, NOW } from "@/testing/fixtures";
import type { ProblemView, WarningView } from "@/src/fleet/application/views";
import { fixIcon, flagsOf, flagSummary, isQuiet, narrowFlagIcon, worstFlag } from "./fleet-flags";

const missing: ProblemView = { code: "manifest-missing", text: "The manifest at /x/manifest.md does not exist yet", fix: { kind: "fleet-tab" } };
const unreadable: ProblemView = { code: "unreadable-rows", text: "2 manifest rows cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const forge: ProblemView = { code: "no-credential", text: "no GitHub account can read other-org", fix: { kind: "connect", role: "forge" } };
const tracker: ProblemView = { code: "no-credential", text: "no Linear account reads team PLAT", fix: { kind: "connect", role: "tracker" } };
const gone: ProblemView = { code: "manager-gone", text: "The manager thread is archived or gone: run /run-fleet in a new thread to take the fleet over", fix: { kind: "none" } };
const other: ProblemView = { code: "credential-refused", text: "GitHub does not answer", fix: { kind: "none" } };
const expires: WarningView = { kind: "expires", label: "GitHub · yuser for acme", credentialId: "c1", accountId: "a1", role: "forge", expiresAt: NOW, daysLeft: 3 };
const late: WarningView = { kind: "polling-late", lastPolledAt: ago(9 * MINUTE) };

describe("a fleet's flags", () => {
  it("are its problems in red and its warnings in amber, in the board's order whatever the server's", () => {
    const flags = flagsOf(fleetCard({ problems: [other, gone, forge, unreadable, missing], warnings: [late, expires] }), NOW);
    expect(flags.map((flag) => [flag.kind, flag.verb, flag.sentence.slice(0, 20)])).toEqual([
      ["problem", "Review", missing.text.slice(0, 20)],
      ["problem", "Review", unreadable.text.slice(0, 20)],
      ["problem", "Connect…", forge.text.slice(0, 20)],
      ["problem", null, gone.text.slice(0, 20)],
      ["problem", null, other.text.slice(0, 20)],
      ["warning", "Renew…", "GitHub · yuser for a"],
      ["warning", null, "polling is late: pol"],
    ]);
  });

  it("keeps a half's Connect… before a left-behind fleet's problem, so the board's fix column offers it (#270 AC6)", () => {
    const left: ProblemView = { code: "left-behind", text: "Its manifest now names github.com/org/wake, so nothing in it is this fleet's.", fix: { kind: "none" } };
    const flags = flagsOf(fleetCard({ problems: [left, forge] }), NOW);
    expect(flags.map((flag) => [flag.verb, flag.sentence])).toEqual([
      ["Connect…", forge.text],
      [null, left.text],
    ]);
  });

  it("each carry where they are put right", () => {
    const [review, connect, renew, polling] = flagsOf(fleetCard({ problems: [missing, forge], warnings: [expires, late] }), NOW);
    expect(review!.fix).toEqual({ kind: "fleet-tab" });
    expect(connect!.fix).toEqual({ kind: "connect", role: "forge" });
    expect(renew!.fix).toEqual({ kind: "renew", role: "forge", accountId: "a1", credentialId: "c1" });
    expect(renew!.sentence).toBe("GitHub · yuser for acme: token expires in 3 days");
    expect(polling).toMatchObject({ fix: { kind: "none" }, saidElsewhere: true });
  });

  it("offer no Connect… for a refusal another account would not fix, such as a service that does not answer", () => {
    const silent: ProblemView = { code: "credential-refused", text: "The service did not answer reads with the credential for github.com/org", fix: { kind: "none" } };
    const [flag] = flagsOf(fleetCard({ problems: [silent] }), NOW);
    expect(flag).toMatchObject({ kind: "problem", verb: null, fix: { kind: "none" } });
    expect(fixIcon(flag!)).toBe("CircleX");
  });

  it("leave out sharing the agents' rate limit, which only the Fleet tab says", () => {
    expect(flagsOf(fleetCard({ warnings: [{ kind: "shares-rate-limit", label: "GitHub · yuser" }] }), NOW)).toEqual([]);
  });

  it("read as the first verb with how many more: a fleet needing both halves with unreadable rows reads Review +2", () => {
    expect(flagSummary(flagsOf(fleetCard({ problems: [forge, tracker, unreadable] }), NOW))).toBe("Review +2");
    expect(flagSummary(flagsOf(fleetCard({ problems: [forge] }), NOW))).toBe("Connect…");
    expect(flagSummary(flagsOf(fleetCard({ problems: [gone, other] }), NOW))).toBe("+1");
    expect(flagSummary([])).toBeNull();
  });

  it("mark the fleet by the worst of them", () => {
    expect(worstFlag(flagsOf(fleetCard({ problems: [gone], warnings: [late] }), NOW))).toBe("problem");
    expect(worstFlag(flagsOf(fleetCard({ warnings: [late] }), NOW))).toBe("warning");
    expect(worstFlag([])).toBeNull();
  });
});

describe("a quiet fleet", () => {
  it("has every Status count at zero, no problem and no warning", () => {
    expect(isQuiet(fleetCard(), NOW)).toBe(true);
    expect(isQuiet(fleetCard({ landed: 1 }), NOW)).toBe(false);
    expect(isQuiet(fleetCard({ blocked: 1 }), NOW)).toBe(false);
  });

  it("is never one with a missing manifest, even with every count at zero", () => {
    expect(isQuiet(fleetCard({ problems: [missing] }), NOW)).toBe(false);
    expect(isQuiet(fleetCard({ warnings: [late] }), NOW)).toBe(false);
  });
});

describe("a flag's icon", () => {
  it("is its verb's icon, a ✕ for a problem nothing fixes, and nothing for polling the polling cell says", () => {
    const flags = flagsOf(fleetCard({ problems: [missing, forge, gone], warnings: [expires, late] }), NOW);
    expect(flags.map(fixIcon)).toEqual(["AlertTriangle", "ElectricPlugs", "CircleX", "unattendish-sdlc/key", null]);
  });

  it("is ⚠ on a phone for a problem or a polling warning, and a key for a token to renew", () => {
    expect(narrowFlagIcon(flagsOf(fleetCard({ problems: [gone] }), NOW))).toBe("AlertTriangle");
    expect(narrowFlagIcon(flagsOf(fleetCard({ warnings: [late] }), NOW))).toBe("AlertTriangle");
    expect(narrowFlagIcon(flagsOf(fleetCard({ warnings: [expires] }), NOW))).toBe("unattendish-sdlc/key");
    expect(narrowFlagIcon([])).toBeNull();
  });
});
