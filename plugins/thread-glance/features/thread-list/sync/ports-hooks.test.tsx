// @vitest-environment jsdom
// AC9: rows read ports from the one snapshot through a hook by environment, and
// a new snapshot renders only the readers of an environment whose listeners changed.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PortListener, PortsSnapshot } from "@/shared/ports";
import { usePortListeners } from "./hooks";
import { endPluginLifetime } from "./lifetime";
import { pluginData } from "./plugin-data";

const listener = (port: number): PortListener => ({ port, address: "127.0.0.1", process: "node", pid: port, startedAt: 1, ownerThreadId: null, container: null });
const signal = (version: number, environments: PortsSnapshot["environments"]) => ({ epoch: "e", version, value: { at: version, environments, failedHosts: [] } });

beforeEach(() => endPluginLifetime());
afterEach(() => cleanup());

describe("usePortListeners", () => {
  it("renders a reader again only when its own environment's listeners change", () => {
    const rendered = { a: 0, b: 0, none: 0 };
    const a = renderHook(() => (rendered.a++, usePortListeners("env_a")));
    const b = renderHook(() => (rendered.b++, usePortListeners("env_b")));
    const none = renderHook(() => (rendered.none++, usePortListeners(null)));
    act(() => pluginData.portsSignal(signal(1, { env_a: { hostId: "h", listeners: [listener(1)] }, env_b: { hostId: "h", listeners: [listener(2)] } })));
    expect(a.result.current).toHaveLength(1);
    expect(b.result.current).toHaveLength(1);
    expect(none.result.current).toHaveLength(0);
    const before = { ...rendered };
    // A refresh that changed environment b alone.
    act(() => pluginData.portsSignal(signal(2, { env_a: { hostId: "h", listeners: [listener(1)] }, env_b: { hostId: "h", listeners: [listener(2), listener(3)] } })));
    expect(rendered).toEqual({ a: before.a, b: before.b + 1, none: before.none });
    // A refresh that changed nothing.
    act(() => pluginData.portsSignal(signal(3, { env_a: { hostId: "h", listeners: [listener(1)] }, env_b: { hostId: "h", listeners: [listener(2), listener(3)] } })));
    expect(rendered).toEqual({ a: before.a, b: before.b + 1, none: before.none });
  });

  it("drops the listeners of an environment that is gone", () => {
    const a = renderHook(() => usePortListeners("env_a"));
    act(() => pluginData.portsSignal(signal(1, { env_a: { hostId: "h", listeners: [listener(1)] } })));
    expect(a.result.current).toHaveLength(1);
    act(() => pluginData.portsSignal(signal(2, {})));
    expect(a.result.current).toHaveLength(0);
  });

  it("is not changed by an older version of the same epoch, and is replaced by a new epoch", () => {
    const a = renderHook(() => usePortListeners("env_a"));
    act(() => pluginData.portsSignal(signal(5, { env_a: { hostId: "h", listeners: [listener(1)] } })));
    act(() => pluginData.portsSignal(signal(4, {})));
    expect(a.result.current).toHaveLength(1);
    act(() => pluginData.portsSignal({ ...signal(1, {}), epoch: "restarted" }));
    expect(a.result.current).toHaveLength(0);
  });
});
