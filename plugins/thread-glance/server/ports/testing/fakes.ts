// Fakes for the ports service: a host that holds listeners per machine, an
// environment directory that holds locations, and a clock.
import { hostContract, type HostListener, type HostSignalResult } from "../../../shared/ports";
import type { EnvironmentDirectory, EnvironmentLocation } from "../environments";
import type { PortsHost } from "../host";

/** A listener as a host reports it; override what a test cares about. */
export function hostListener(overrides: Partial<HostListener> = {}): HostListener {
  return {
    port: 5173,
    address: "127.0.0.1",
    process: "node",
    pid: 100,
    startedAt: 1_000,
    workspace: "/work/app",
    ownerThreadId: null,
    container: null,
    ...overrides,
  };
}

export interface FakePortsHost extends PortsHost {
  /** What each machine reports; an Error makes its scan fail. Only the listeners inside the requested workspaces are returned. */
  machines: Map<string, { supported: boolean; listeners: HostListener[] } | Error>;
  /** The machines scanned, in order, with the workspaces asked for. */
  scans: { hostId: string; workspaces: string[] }[];
  /** The signals asked for, in order. */
  signals: { hostId: string; port: number; pid: number; startedAt: number; workspaces: string[] }[];
  /** What a signal answers; by default `sent`. */
  signalResult: (signal: FakePortsHost["signals"][number]) => HostSignalResult | Error;
  /** Runs inside each scan before it answers; lets a test change a machine between two steps. */
  beforeScan: ((hostId: string) => void | Promise<void>) | null;
}

export function createFakePortsHost(machines: Record<string, HostListener[] | Error> = {}): FakePortsHost {
  const fake: FakePortsHost = {
    machines: new Map(Object.entries(machines).map(([hostId, value]) => [hostId, value instanceof Error ? value : { supported: true, listeners: value }])),
    scans: [],
    signals: [],
    signalResult: () => "sent",
    beforeScan: null,
    async scan(hostId, workspaces) {
      // The real call validates its input against the contract; so does the fake.
      if (!hostContract.scan.input.safeParse({ workspaces }).success) throw new Error("invalid scan input");
      fake.scans.push({ hostId, workspaces: [...workspaces] });
      await fake.beforeScan?.(hostId);
      const machine = fake.machines.get(hostId);
      if (machine === undefined) throw new Error("no such machine");
      if (machine instanceof Error) throw machine;
      return { supported: machine.supported, listeners: machine.listeners.filter((listener) => workspaces.includes(listener.workspace)).map((listener) => ({ ...listener })) };
    },
    async signal(hostId, target) {
      if (!hostContract.signal.input.safeParse(target).success) throw new Error("invalid signal input");
      const signal = { hostId, ...target, workspaces: [...target.workspaces] };
      fake.signals.push(signal);
      const result = fake.signalResult(signal);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return fake;
}

export interface FakeEnvironments extends EnvironmentDirectory {
  locations: Map<string, EnvironmentLocation>;
  resolved: string[][];
  /** Makes every lookup fail. */
  fail: boolean;
  /** Environments bb cannot answer for, while the others resolve. */
  failIds: Set<string>;
}

export function createFakeEnvironments(locations: Record<string, EnvironmentLocation> = {}): FakeEnvironments {
  const fake: FakeEnvironments = {
    locations: new Map(Object.entries(locations)),
    resolved: [],
    fail: false,
    failIds: new Set(),
    async resolve(ids) {
      fake.resolved.push([...ids]);
      if (fake.fail) throw new Error("bb could not answer");
      const failed = new Set(ids.filter((id) => fake.failIds.has(id)));
      const locations = new Map(ids.flatMap((id) => (fake.locations.has(id) && !failed.has(id) ? [[id, fake.locations.get(id)!] as const] : [])));
      return { locations, failed };
    },
  };
  return fake;
}

/** A settable clock. */
export function createClock(start = 1_000_000) {
  const clock = { now: start, read: () => clock.now, advance: (ms: number) => (clock.now += ms) };
  return clock;
}
