import { describe, expect, it } from "vitest";
import { actionRecord, ago, fleetCard, HOUR, MINUTE, NOW } from "@/testing/fixtures";
import { lastActionText, managerCell, sentAgo, sentText, spendText, statusSlots } from "./model";

describe("the fleet header", () => {
  it("say a working manager works, with no duration", () => {
    expect(managerCell({ state: "working", since: ago(HOUR) }, NOW)).toEqual({ state: "working", duration: null, words: "Manager working" });
  });

  it("say how long an idle manager has been idle", () => {
    expect(managerCell({ state: "idle", since: ago(10 * MINUTE) }, NOW)).toEqual({ state: "idle", duration: "10m", words: "Manager idle for 10m" });
  });

  it("say a fleet has no manager, with no duration", () => {
    expect(managerCell({ state: "none", since: null }, NOW)).toMatchObject({ state: "none", duration: null });
  });

  it("keep four Status slots in order, a zero left empty in its place", () => {
    expect(statusSlots(fleetCard({ blocked: 1, inFlight: 2, waiting: 6, landed: 1 })).map((slot) => slot.count)).toEqual([1, 2, 6, 1]);
    const wake = statusSlots(fleetCard({ waiting: 1 }));
    expect(wake.map((slot) => slot.count)).toEqual([null, null, 1, null]);
    expect(statusSlots(fleetCard({ waiting: 6 }))[2]!.label).toBe("6 waiting on you");
  });

  it("show spend only where it is known", () => {
    expect(spendText(fleetCard({ cost: { amount: 4.2, currency: "$", period: "since this manager started" } }))).toBe("$4.20");
    expect(spendText(fleetCard({ cost: null }))).toBeNull();
  });

  it("says what the operator did, and how long ago it was seen done", () => {
    const action = actionRecord({ kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) });
    expect(`${sentText(action)} · ${sentAgo(action, NOW)}`).toBe("You answered #5 Which queue · 40m ago");
    expect(sentText(actionRecord({ kind: "grant", ref: "#6", what: "Merge it" }))).toBe("You granted #6 Merge it");
    expect(sentText(actionRecord({ kind: "build", ref: "#7", what: "Dark mode" }))).toBe("You asked to build #7 Dark mode");
    });

  it("says the last action with how long ago it was seen done", () => {
    const action = actionRecord({ kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) });
    expect(lastActionText(action, NOW)).toBe("You answered #5 Which queue · done 40m ago");
  });
});
