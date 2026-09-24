// Counts what a run costs: host entry calls per machine and method, programs
// the server process starts, and bb and network calls. The engine logs one
// line per run from these, so a run's cost can be read from the plugin log.

/** Counters since the plugin loaded; a run reports the difference. */
export interface Tally {
  /** `hostId method` → calls and milliseconds. */
  host: Map<string, { calls: number; ms: number }>;
  /** Anything else by name: `spawn`, `sdk:providers`, `fetch:github-meta`… */
  counts: Map<string, number>;
}

const tally: Tally = { host: new Map(), counts: new Map() };

/** Adds one call to a machine's host entry. */
export function countHostCall(hostId: string, method: string, ms: number): void {
  const key = `${hostId} ${method}`;
  const entry = tally.host.get(key) ?? { calls: 0, ms: 0 };
  entry.calls += 1;
  entry.ms += ms;
  tally.host.set(key, entry);
}

export function count(name: string): void {
  tally.counts.set(name, (tally.counts.get(name) ?? 0) + 1);
}

/** Counts `name` and adds the milliseconds `work` takes to `name ms`. */
export function timed<T>(name: string, work: Promise<T>): Promise<T> {
  count(name);
  const started = performance.now();
  const add = () => tally.counts.set(`${name} ms`, (tally.counts.get(`${name} ms`) ?? 0) + Math.round(performance.now() - started));
  work.then(add, add);
  return work;
}

export function snapshot(): Tally {
  return {
    host: new Map([...tally.host].map(([key, value]) => [key, { ...value }])),
    counts: new Map(tally.counts),
  };
}

/** What happened between two snapshots, per machine. */
export function since(before: Tally): {
  hosts: Record<string, { calls: Record<string, number>; ms: number }>;
  counts: Record<string, number>;
} {
  const hosts: Record<string, { calls: Record<string, number>; ms: number }> = {};
  for (const [key, value] of tally.host) {
    const prior = before.host.get(key) ?? { calls: 0, ms: 0 };
    if (value.calls === prior.calls) continue;
    const [hostId, method] = key.split(" ") as [string, string];
    const host = (hosts[hostId] ??= { calls: {}, ms: 0 });
    host.calls[method] = value.calls - prior.calls;
    host.ms += Math.round(value.ms - prior.ms);
  }
  const counts: Record<string, number> = {};
  for (const [name, value] of tally.counts) {
    const delta = value - (before.counts.get(name) ?? 0);
    if (delta > 0) counts[name] = delta;
  }
  return { hosts, counts };
}
