// The ports snapshot's pure steps: sharing what did not change, which entries
// link (AC5) and which can be stopped (AC4), and the port lists the prompts read.
import { describe, expect, it } from "vitest";
import type { PortListener, PortsSnapshot } from "@/shared/ports";
import type { Versioned } from "@/shared/signals";
import { listenersOf, NO_LISTENERS, portIndicatorLabel, portLinkHref, portList, sharePorts, stopTarget } from "./ports";

const listener = (patch: Partial<PortListener> = {}): PortListener => ({
  port: 5173,
  address: "127.0.0.1",
  process: "node",
  pid: 100,
  startedAt: 1_000,
  ownerThreadId: null,
  container: null,
  ...patch,
});

const snapshot = (environments: PortsSnapshot["environments"], version = 1, failedHosts: string[] = []): Versioned<PortsSnapshot> => ({
  epoch: "e",
  version,
  value: { at: version, environments, failedHosts },
});

describe("listenersOf", () => {
  it("is the environment's listeners, and one empty array for any environment without", () => {
    const held = snapshot({ env_a: { hostId: "h", listeners: [listener()] } }).value;
    expect(listenersOf(held, "env_a")).toHaveLength(1);
    expect(listenersOf(held, "env_b")).toBe(NO_LISTENERS);
    expect(listenersOf(held, null)).toBe(NO_LISTENERS);
    expect(listenersOf(null, "env_a")).toBe(NO_LISTENERS);
  });
});

describe("sharePorts", () => {
  it("keeps the held entry of every environment whose listeners did not change", () => {
    const held = snapshot({
      a: { hostId: "h", listeners: [listener()] },
      b: { hostId: "h", listeners: [listener({ port: 3000 })] },
    });
    const next = snapshot(
      {
        a: { hostId: "h", listeners: [listener()] },
        b: { hostId: "h", listeners: [listener({ port: 3000 }), listener({ port: 3001 })] },
      },
      2,
    );
    const shared = sharePorts(held, next);
    expect(shared.value.environments.a).toBe(held.value.environments.a);
    expect(shared.value.environments.b).toBe(next.value.environments.b);
    expect(shared.value.at).toBe(2);
  });

  it("drops an environment that is gone, and takes a new epoch whole", () => {
    const held = snapshot({ a: { hostId: "h", listeners: [listener()] } });
    expect(sharePorts(held, snapshot({}, 2)).value.environments).toEqual({});
    const other = { ...snapshot({ a: { hostId: "h", listeners: [listener()] } }), epoch: "f" };
    expect(sharePorts(held, other)).toBe(other);
  });

  it("keeps the failed hosts array while it holds the same machines", () => {
    const held = snapshot({}, 1, ["m1"]);
    expect(sharePorts(held, snapshot({}, 2, ["m1"])).value.failedHosts).toBe(held.value.failedHosts);
  });
});

describe("stopTarget", () => {
  it("is the port, PID and start time, and null for a port only Docker reports", () => {
    expect(stopTarget(listener())).toEqual({ port: 5173, pid: 100, startedAt: 1_000 });
    expect(stopTarget(listener({ process: null, pid: null, startedAt: null, container: "web" }))).toBeNull();
  });
});

describe("portLinkHref (AC5)", () => {
  it("links loopback and wildcard addresses on 127.0.0.1 when the host is the chosen machine", () => {
    for (const address of ["127.0.0.1", "127.0.1.1", "0.0.0.0", "*", "::", "[::]"]) {
      expect(portLinkHref(listener({ address }), "h1", "h1"), address).toBe("http://127.0.0.1:5173");
    }
  });

  it("links a port bound to ::1 on [::1]", () => {
    expect(portLinkHref(listener({ address: "::1" }), "h1", "h1")).toBe("http://[::1]:5173");
    expect(portLinkHref(listener({ address: "[::1]" }), "h1", "h1")).toBe("http://[::1]:5173");
  });

  it("uses https for 443 and 8443 only", () => {
    expect(portLinkHref(listener({ port: 443 }), "h1", "h1")).toBe("https://127.0.0.1:443");
    expect(portLinkHref(listener({ port: 8443, address: "::1" }), "h1", "h1")).toBe("https://[::1]:8443");
    expect(portLinkHref(listener({ port: 8080 }), "h1", "h1")).toBe("http://127.0.0.1:8080");
  });

  it("links nothing without a chosen machine, for another machine, or for a LAN address", () => {
    expect(portLinkHref(listener(), "h1", null)).toBeNull();
    expect(portLinkHref(listener(), "h1", "h2")).toBeNull();
    expect(portLinkHref(listener({ address: "192.168.1.5" }), "h1", "h1")).toBeNull();
  });
});

describe("texts", () => {
  it("lists ports once each, lowest first", () => {
    expect(portList([5173, 3000, 5173])).toBe(":3000, :5173");
  });

  it("counts the indicator's ports in its name", () => {
    expect(portIndicatorLabel(1)).toBe("1 workspace port");
    expect(portIndicatorLabel(3)).toBe("3 workspace ports");
  });
});
