// The plugin's data in one window: a signal that comes before the first
// answer is kept for it, and realtime coming back asks for what it missed.
import { afterEach, describe, expect, it } from "vitest";
import { endPluginLifetime } from "./lifetime";
import { pluginData, type SyncAnswer } from "./plugin-data";

afterEach(() => endPluginLifetime());

const answer = (revision: number, records: SyncAnswer["records"]): SyncAnswer => ({
  epoch: "e1",
  revision,
  full: true,
  preferences: {} as SyncAnswer["preferences"],
  scheduled: { status: "ready", scheduled: {} },
  records,
});

describe("the plugin's data", () => {
  it("keeps a signal that comes before the first answer, when the answer was made before it", () => {
    pluginData.signal({ epoch: "e1", revision: 2, records: { a: { stamps: { startedAt: 2 }, notes: null } } });
    pluginData.signal({ epoch: "e1", revision: 1, records: { b: { stamps: { startedAt: 1 }, notes: null } } });
    pluginData.synced(answer(1, { b: { stamps: { startedAt: 1 }, notes: null } }));
    expect(pluginData.get().records.stamps.startedAt).toEqual({ a: 2, b: 1 });
    expect(pluginData.get().records.point).toEqual({ epoch: "e1", revision: 2 });
  });

  it("asks once realtime is up, not again for its first connection", () => {
    const stop = pluginData.follow();
    expect(pluginData.connection("connecting")).toBe(false);
    expect(pluginData.connection("connected")).toBe(true);
    pluginData.synced(answer(1, {}));
    expect(pluginData.connection("connected")).toBe(false);
    stop();
  });

  it("asks for what it missed once realtime is back, and stops drawing as current while it is down", () => {
    const stop = pluginData.follow();
    expect(pluginData.connection("connected")).toBe(true);
    pluginData.synced(answer(1, {}));
    expect(pluginData.connection("connected")).toBe(false);
    expect(pluginData.connection("reconnecting")).toBe(false);
    expect(pluginData.get().status).toBe("waiting");
    expect(pluginData.connection("reconnecting")).toBe(false);
    expect(pluginData.connection("connected")).toBe(true);
    pluginData.synced(answer(2, {}));
    expect(pluginData.connection("connected")).toBe(false);
    stop();
  });
});
