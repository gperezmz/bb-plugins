import { describe, expect, it } from "vitest";
import type { ProblemView, WarningView } from "@/src/fleet/application/views";
import { fleetCard, NOW } from "@/testing/fixtures";
import { isLeftBehind, nameList, sharedText, shownFleet, threadFleetOrder } from "./thread-fleets";

const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const leftBehind: ProblemView = { code: "left-behind", text: "Its manifest now names org/wake", fix: { kind: "none" } };
const expiring: WarningView = { kind: "expires", label: "GitHub · yuser", credentialId: "c", accountId: "a", role: "forge", expiresAt: "2026-10-15T12:00:00Z", daysLeft: 3 };
const held = (repo: string, over = {}) => ({ card: fleetCard({ repo, ...over }) });
const names = (fleets: readonly { card: { repo: string } }[]) => fleets.map((fleet) => fleet.card.repo);

describe("the order of a thread's fleets (#270 AC2)", () => {
  it("puts a problem before a warning before neither, then most waiting, then by name, and left-behind fleets last", () => {
    const fleets = [held("org/quiet"), held("org/b", { waiting: 6 }), held("org/a", { waiting: 6 }), held("org/warn", { warnings: [expiring] }), held("org/gone", { problems: [leftBehind] }), held("org/bad", { waiting: 2, problems: [unreadable] })];
    expect(names(threadFleetOrder(fleets, NOW))).toEqual(["org/bad", "org/warn", "org/a", "org/b", "org/quiet", "org/gone"]);
  });

  it("takes org/wake, with 2 waiting and an unreadable row, before org/dash with 6 and no flag", () => {
    expect(names(threadFleetOrder([held("org/dash", { waiting: 6 }), held("org/wake", { waiting: 2, problems: [unreadable] })], NOW))).toEqual(["org/wake", "org/dash"]);
  });

  it("knows a left-behind fleet by its problem", () => {
    expect(isLeftBehind(fleetCard({ problems: [leftBehind] }))).toBe(true);
    expect(isLeftBehind(fleetCard({ problems: [unreadable] }))).toBe(false);
  });
});

describe("the fleet the Fleet tab shows (#270 AC2)", () => {
  const ordered = [held("org/wake"), held("org/dash")];
  it("is the one wanted where the thread holds it", () => {
    expect(shownFleet(ordered, "org/dash")!.card.repo).toBe("org/dash");
  });
  it("is the first in order with none wanted, or one the thread does not hold", () => {
    expect(shownFleet(ordered, null)!.card.repo).toBe("org/wake");
    expect(shownFleet(ordered, "org/gone")!.card.repo).toBe("org/wake");
  });
  it("is none for a thread that holds none", () => {
    expect(shownFleet([], "org/dash")).toBeNull();
  });
});

describe("the spend shared with the thread's other fleets (#270 AC5)", () => {
  it("names the others", () => {
    expect(sharedText(fleetCard({ cost: { amount: 4.12, currency: "$", period: "p", sharedWith: ["org/wake"] } }))).toBe("shared with org/wake");
    expect(nameList(["org/a", "org/b", "org/c"])).toBe("org/a, org/b and org/c");
  });
  it("says nothing for a fleet alone on its thread, or with no spend", () => {
    expect(sharedText(fleetCard({ cost: { amount: 4.12, currency: "$", period: "p", sharedWith: [] } }))).toBeNull();
    expect(sharedText(fleetCard({ cost: null }))).toBeNull();
  });
});
