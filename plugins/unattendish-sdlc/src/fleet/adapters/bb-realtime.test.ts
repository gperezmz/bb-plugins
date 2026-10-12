import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { BbDashboardEvents } from "./bb-realtime";

describe("BbDashboardEvents", () => {
  it("publishes board-changed with no payload and inbox-new with the signal", () => {
    const host = createFakePluginHost({ pluginId: "unattendish-sdlc" });
    const events = new BbDashboardEvents(host.bb.realtime, { warn: () => undefined });
    events.boardChanged();
    events.inboxNew({ fleet: "github.com/org/repo", ref: "#7", what: "A parked question", rowId: "#7|answer|2026-10-12T09:00:00Z" });
    expect(host.harness.realtimeSignals).toEqual([
      { channel: "board-changed", payload: null },
      { channel: "inbox-new", payload: { fleet: "github.com/org/repo", ref: "#7", what: "A parked question", rowId: "#7|answer|2026-10-12T09:00:00Z" } },
    ]);
  });

  it("swallows a publish that throws and says so without the payload", () => {
    const warnings: string[] = [];
    const events = new BbDashboardEvents({ publish: () => { throw new Error("socket closed"); } }, { warn: (m) => warnings.push(m) });
    expect(() => events.inboxNew({ fleet: "f", ref: "r", what: "secret words", rowId: "id" })).not.toThrow();
    expect(warnings).toEqual(["could not publish on inbox-new"]);
  });
});
