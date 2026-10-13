import { describe, expect, it } from "vitest";
import type { ProblemView, WarningView } from "@/src/fleet/application/views";
import { fleetCard, NOW } from "@/testing/fixtures";
import { chipFace } from "./model";

const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const expiring: WarningView = { kind: "expires", label: "GitHub · yuser for acme", credentialId: "c", accountId: "a", role: "forge", expiresAt: "2026-10-15T12:00:00Z", daysLeft: 3 };

describe("the Fleet chip's face (#258 AC10)", () => {
  it("shows the rows that wait with a red dot for a problem", () => {
    expect(chipFace([fleetCard({ waiting: 6, problems: [unreadable] })], NOW)).toEqual({ count: 6, dot: "problem", label: "Fleet: 6 waiting on you, and it has a problem" });
  });

  it("is the icon alone with nothing waiting and nothing flagged, whatever else is in flight", () => {
    expect(chipFace([fleetCard({ inFlight: 2 })], NOW)).toEqual({ count: null, dot: null, label: "Fleet: nothing waits on you" });
  });

  it("shows an amber dot and no count for a warning alone", () => {
    expect(chipFace([fleetCard({ warnings: [expiring] })], NOW)).toEqual({ count: null, dot: "warning", label: "Fleet: nothing waits on you, and it has a warning" });
  });

  it("dots a problem red even beside a warning", () => {
    expect(chipFace([fleetCard({ problems: [unreadable], warnings: [expiring] })], NOW).dot).toBe("problem");
  });

  it("leaves the dot off for sharing the agents' rate limit, which only the credential card says", () => {
    expect(chipFace([fleetCard({ warnings: [{ kind: "shares-rate-limit", label: "gh" }] })], NOW).dot).toBeNull();
  });
});

describe("the Fleet chip of a thread holding more than one fleet (#270 AC4)", () => {
  it("sums the rows waiting and dots red for a problem in any fleet", () => {
    expect(chipFace([fleetCard({ repo: "org/dash", waiting: 6 }), fleetCard({ repo: "org/wake", waiting: 2, problems: [unreadable] })], NOW)).toEqual({ count: 8, dot: "problem", label: "2 fleets: 8 waiting on you, and a fleet has a problem" });
  });

  it("is the icon alone with nothing waiting and nothing flagged in any fleet", () => {
    expect(chipFace([fleetCard({ repo: "org/dash" }), fleetCard({ repo: "org/wake" })], NOW)).toEqual({ count: null, dot: null, label: "2 fleets: nothing waits on you" });
  });

  it("dots amber for a warning in any fleet when none has a problem", () => {
    expect(chipFace([fleetCard({ repo: "org/dash", warnings: [expiring] }), fleetCard({ repo: "org/wake" })], NOW).dot).toBe("warning");
  });
});
