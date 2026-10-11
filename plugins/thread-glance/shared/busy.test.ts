import { describe, expect, it } from "vitest";
import { isBusy, isWorking, type BusyInput } from "./busy";

const idle: BusyInput = {
  hasPendingInteraction: false,
  queuedWork: "none",
  status: "idle",
  runtimeStatus: "idle",
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
};

const busy = (overrides: Partial<BusyInput>): BusyInput => ({ ...idle, ...overrides });

describe("isBusy", () => {
  it("is false for an idle thread", () => {
    expect(isBusy(idle)).toBe(false);
  });

  it.each([
    ["a pending question or approval", { hasPendingInteraction: true }],
    ["a queued message", { queuedWork: "waiting" }],
    ["a queued message that failed", { queuedWork: "failed" }],
    ["a turn in flight", { status: "active" }],
    ["a turn starting", { status: "starting" }],
    ["a turn stopping", { status: "stopping" }],
    ["a never-run thread whose first message waits to send", { status: "pending", queuedWork: "waiting" }],
    ["a never-run thread whose first message failed to send", { status: "pending", queuedWork: "failed" }],
    ["a runtime that is active between turns", { runtimeStatus: "active" }],
    ["a runtime that is starting", { runtimeStatus: "starting" }],
    ["a runtime that is provisioning", { runtimeStatus: "provisioning" }],
  ] satisfies [string, Partial<BusyInput>][])("is true for %s", (_, overrides) => {
    expect(isBusy(busy(overrides))).toBe(true);
  });

  it.each(["workflows", "backgroundAgents", "backgroundCommands", "planMode", "goals"] as const)(
    "is true when the %s counter is above zero",
    (counter) => {
      expect(isBusy(busy({ activity: { ...idle.activity, [counter]: 1 } }))).toBe(true);
    },
  );

  it("is false for a failed thread, a machine that is offline, and statuses it does not know", () => {
    expect(isBusy(busy({ status: "error", runtimeStatus: "error" }))).toBe(false);
    expect(isBusy(busy({ runtimeStatus: "waiting-for-host" }))).toBe(false);
    expect(isBusy(busy({ status: "novel", runtimeStatus: "novel", queuedWork: "novel" }))).toBe(false);
  });

  it("is false for a never-run thread with nothing queued", () => {
    expect(isBusy(busy({ status: "pending" }))).toBe(false);
  });

  it("is true for a thread whose only sign of life is a running monitor", () => {
    expect(isBusy(busy({ status: "idle", runtimeStatus: "active" }))).toBe(true);
  });
});

describe("isWorking", () => {
  it("leaves out a pending question and a queued message", () => {
    expect(isWorking(busy({ hasPendingInteraction: true, queuedWork: "waiting" }))).toBe(false);
  });

  it("is false for a never-run thread, with its first message waiting or not", () => {
    expect(isWorking(busy({ status: "pending" }))).toBe(false);
    expect(isWorking(busy({ status: "pending", queuedWork: "waiting" }))).toBe(false);
  });
});
