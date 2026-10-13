import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fakes";
import { BbDashboardEvents, BOARD_CHANGED_EVERY_MS } from "./bb-realtime";

const setup = () => {
  const host = createFakePluginHost({ pluginId: "unattendish-sdlc" });
  const clock = new FakeClock();
  const timers: { work: () => void; ms: number }[] = [];
  const events = new BbDashboardEvents(host.bb.realtime, { warn: () => undefined }, clock, (work, ms) => timers.push({ work, ms }));
  const boards = () => host.harness.realtimeSignals.filter((signal) => signal.channel === "board-changed").length;
  return { host, clock, timers, events, boards };
};

describe("BbDashboardEvents", () => {
  it("publishes board-changed with no payload and inbox-new with the signal", () => {
    const { host, events } = setup();
    events.boardChanged();
    events.inboxNew({ fleet: "github.com/org/repo", ref: "#7", what: "A parked question", rowId: "#7|answer|2026-10-12T09:00:00Z", waitsFor: "answer", forge: "github" });
    expect(host.harness.realtimeSignals).toEqual([
      { channel: "board-changed", payload: null },
      { channel: "inbox-new", payload: { fleet: "github.com/org/repo", ref: "#7", what: "A parked question", rowId: "#7|answer|2026-10-12T09:00:00Z", waitsFor: "answer", forge: "github" } },
    ]);
  });

  it("swallows a publish that throws and says so without the payload", () => {
    const warnings: string[] = [];
    const events = new BbDashboardEvents({ publish: () => { throw new Error("socket closed"); } }, { warn: (m) => warnings.push(m) }, new FakeClock());
    expect(() => events.inboxNew({ fleet: "f", ref: "r", what: "secret words", rowId: "id", waitsFor: "answer", forge: "github" })).not.toThrow();
    expect(warnings).toEqual(["could not publish on inbox-new"]);
  });
});

describe("board-changed coalescing", () => {
  it("publishes the first change at once, and a burst after it as one trailing signal when the second is up", () => {
    const { clock, timers, events, boards } = setup();
    events.boardChanged();
    expect(boards()).toBe(1);
    clock.advance(100);
    events.boardChanged();
    clock.advance(100);
    events.boardChanged();
    events.boardChanged();
    expect(boards()).toBe(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(BOARD_CHANGED_EVERY_MS - 100);

    clock.advance(timers[0]!.ms - 100);
    timers[0]!.work();
    expect(boards()).toBe(2);
  });

  it("never loses the last change: one made just after a trailing signal waits for the next second", () => {
    const { clock, timers, events, boards } = setup();
    events.boardChanged();
    clock.advance(10);
    events.boardChanged();
    clock.advance(BOARD_CHANGED_EVERY_MS);
    timers[0]!.work();
    clock.advance(10);
    events.boardChanged();
    expect(boards()).toBe(2);
    expect(timers).toHaveLength(2);
    clock.advance(timers[1]!.ms);
    timers[1]!.work();
    expect(boards()).toBe(3);
  });

  it("publishes at once again once a second has passed with no change", () => {
    const { clock, timers, events, boards } = setup();
    events.boardChanged();
    clock.advance(BOARD_CHANGED_EVERY_MS);
    events.boardChanged();
    expect(boards()).toBe(2);
    expect(timers).toEqual([]);
  });

  it("does not coalesce inbox-new: each new row is announced", () => {
    const { host, events } = setup();
    for (let n = 0; n < 3; n += 1) events.inboxNew({ fleet: "f", ref: `#${n}`, what: "w", rowId: `r${n}`, waitsFor: "answer", forge: "github" });
    expect(host.harness.realtimeSignals.filter((signal) => signal.channel === "inbox-new")).toHaveLength(3);
  });
});
