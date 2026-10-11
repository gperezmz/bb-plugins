// What the list does with the workspace ports snapshot: which listeners an
// environment has, how a new snapshot shares the parts that did not change,
// which entries can be stopped or linked, and the texts the prompts use.
// Pure; the snapshot's shapes are in `shared/ports`.
import type { PortListener, PortTarget, PortsSnapshot } from "@/shared/ports";
import type { Versioned } from "@/shared/signals";

export const NO_LISTENERS: readonly PortListener[] = Object.freeze([]);

/** The listeners of `environmentId` in `snapshot`; the same empty array when it has none. */
export function listenersOf(snapshot: PortsSnapshot | null, environmentId: string | null | undefined): readonly PortListener[] {
  if (snapshot === null || environmentId == null) return NO_LISTENERS;
  return snapshot.environments[environmentId]?.listeners ?? NO_LISTENERS;
}

function sameListener(a: PortListener, b: PortListener): boolean {
  return (
    a.port === b.port &&
    a.address === b.address &&
    a.process === b.process &&
    a.pid === b.pid &&
    a.startedAt === b.startedAt &&
    a.ownerThreadId === b.ownerThreadId &&
    a.container === b.container
  );
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((entry, index) => same(entry, b[index]!));
}

/**
 * `next` with every part that equals `held` replaced by the held part, so a
 * row that reads one environment's listeners sees the same array until that
 * environment's listeners change, and a refresh that changed one environment
 * renders only that environment's rows.
 */
export function sharePorts(held: Versioned<PortsSnapshot> | null, next: Versioned<PortsSnapshot>): Versioned<PortsSnapshot> {
  if (held === null || held.epoch !== next.epoch) return next;
  const before = held.value;
  const environments: PortsSnapshot["environments"] = {};
  for (const [id, entry] of Object.entries(next.value.environments)) {
    const old = before.environments[id];
    environments[id] = old !== undefined && old.hostId === entry.hostId && sameList(old.listeners, entry.listeners, sameListener) ? old : entry;
  }
  const failedHosts = sameList(before.failedHosts, next.value.failedHosts, Object.is) ? before.failedHosts : next.value.failedHosts;
  return { ...next, value: { at: next.value.at, environments, failedHosts } };
}

/** The target `stopPort` takes for a listener, or null for one with no process to signal (a port only Docker reports). */
export function stopTarget(listener: PortListener): PortTarget | null {
  if (listener.pid === null || listener.startedAt === null) return null;
  return { port: listener.port, pid: listener.pid, startedAt: listener.startedAt };
}

/** Identifies a listener within one environment: what Stop's armed state remembers. */
export function listenerKey(listener: PortListener): string {
  return [listener.port, listener.address, listener.pid ?? "", listener.startedAt ?? "", listener.container ?? ""].join("|");
}

/** What an entry shows next to its port: the executable name, else the Docker container's name. */
export function processLabel(listener: PortListener): string | null {
  return listener.process ?? listener.container;
}

/** The ports that serve the web, which link with `https`. */
const HTTPS_PORTS: ReadonlySet<number> = new Set([443, 8443]);

const WILDCARD_ADDRESSES: ReadonlySet<string> = new Set(["*", "0.0.0.0", "::", "[::]"]);
const IPV6_LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(["::1", "[::1]"]);

/**
 * The URL a port links to when its machine is the port link machine: on
 * 127.0.0.1 for a loopback or wildcard address, on `[::1]` when it is bound to
 * `::1` only, with `https` for 443 and 8443. Null for an address that is
 * neither (a LAN address, say) and when the machine is not the chosen one.
 */
export function portLinkHref(listener: PortListener, hostId: string, machineId: string | null): string | null {
  if (machineId === null || hostId !== machineId) return null;
  const scheme = HTTPS_PORTS.has(listener.port) ? "https" : "http";
  const address = listener.address.trim();
  if (IPV6_LOOPBACK_ADDRESSES.has(address)) return `${scheme}://[::1]:${listener.port}`;
  if (WILDCARD_ADDRESSES.has(address) || /^127(\.\d{1,3}){3}$/.test(address)) return `${scheme}://127.0.0.1:${listener.port}`;
  return null;
}

/** ":3000, :5173": the ports once each, lowest first. */
export function portList(ports: readonly number[]): string {
  return [...new Set(ports)]
    .sort((a, b) => a - b)
    .map((port) => `:${port}`)
    .join(", ");
}

/** The port indicator's accessible name. */
export function portIndicatorLabel(count: number): string {
  return count === 1 ? "1 workspace port" : `${count} workspace ports`;
}

/** The toasts of Stop on a hover card entry, by what the server answered. */
export const STOP_PORT_TEXT = {
  requested: (port: number) => ({ title: `Stop requested for :${port}`, description: "The process received a graceful shutdown request. The port may take a moment to close." }),
  refused: (port: number) => ({ title: `Could not stop :${port}`, description: "That port is no longer listed for this workspace." }),
  gone: (port: number) => ({ title: `Could not stop :${port}`, description: "The process on it has changed or ended." }),
} as const;
