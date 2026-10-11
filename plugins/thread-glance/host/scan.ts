// The host entry's two operations, on the `HostProbe` port: list the
// listeners inside some workspaces, and signal one of them. The command line
// is read only to skip bb's own processes; the environment only for the owner.
import type { HostListener } from "../shared/ports";
import { isBbCommandLine } from "./parse";
import type { HostProbe } from "./probe";
import { matchWorkspace, workspaceMatchers, type WorkspaceMatcher } from "./workspaces";

/** Processes inspected at once. */
const CONCURRENCY = 6;
/** The most listeners a reply holds, as the contract allows. */
const MAX_LISTENERS = 5_000;

const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = ["linux", "darwin"];

async function matchers(probe: HostProbe, workspaces: readonly string[]): Promise<WorkspaceMatcher[]> {
  const real = new Map<string, string | null>();
  await Promise.all(workspaces.map(async (path) => real.set(path, await probe.realpath(path))));
  return workspaceMatchers(workspaces, (path) => real.get(path) ?? null);
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENCY).map(work))));
  }
  return results;
}

export async function scanListeners(
  probe: HostProbe,
  workspaces: readonly string[],
): Promise<{ supported: boolean; listeners: HostListener[] }> {
  if (!SUPPORTED_PLATFORMS.includes(probe.platform)) return { supported: false, listeners: [] };
  const inside = await matchers(probe, workspaces);
  if (inside.length === 0) return { supported: true, listeners: [] };

  const sockets = (await probe.listening()).filter((socket) => !probe.ownPids.includes(socket.pid));
  const cwds = await probe.cwds([...new Set(sockets.map((socket) => socket.pid))]);
  const matched = sockets.flatMap((socket) => {
    const cwd = cwds.get(socket.pid);
    const workspace = cwd === undefined ? null : matchWorkspace(cwd, inside);
    return workspace === null ? [] : [{ socket, workspace }];
  });

  const identities = new Map<number, { startedAt: number; executable: string | null; owner: string | null } | null>();
  await inBatches([...new Set(matched.map(({ socket }) => socket.pid))], async (pid) => {
    const identity = await probe.identify(pid);
    if (identity.startedAt === null || (identity.commandLine !== null && isBbCommandLine(identity.commandLine))) {
      identities.set(pid, null);
      return;
    }
    const owner = await probe.ownerOf(pid, identity.commandLine);
    identities.set(pid, { startedAt: identity.startedAt, executable: identity.executable, owner });
  });

  const listeners: HostListener[] = [];
  for (const { socket, workspace } of matched) {
    const identity = identities.get(socket.pid);
    if (identity == null) continue;
    listeners.push({
      port: socket.port,
      address: socket.address,
      process: identity.executable ?? (socket.command === "" ? null : socket.command),
      pid: socket.pid,
      startedAt: identity.startedAt,
      workspace,
      ownerThreadId: identity.owner,
      container: null,
    });
  }

  for (const published of await probe.docker()) {
    const workspace = matchWorkspace(published.workingDir, inside);
    if (workspace === null) continue;
    const process = listeners.find((listener) => listener.port === published.port && listener.pid !== null);
    if (process !== undefined) {
      process.container ??= published.container;
      continue;
    }
    if (listeners.some((listener) => listener.port === published.port && listener.container === published.container)) continue;
    listeners.push({
      port: published.port,
      address: published.address,
      process: null,
      pid: null,
      startedAt: null,
      workspace,
      ownerThreadId: null,
      container: published.container,
    });
  }
  return { supported: true, listeners: listeners.slice(0, MAX_LISTENERS) };
}

export type SignalResult = "sent" | "changed" | "failed";

/**
 * Sends SIGTERM to the process listening on `port` only if it has `pid` and
 * `startedAt` and its working directory is inside one of `workspaces`.
 */
export async function signalListener(
  probe: HostProbe,
  kill: (pid: number, signal: "SIGTERM") => void,
  input: { port: number; pid: number; startedAt: number; workspaces: readonly string[] },
): Promise<SignalResult> {
  if (!SUPPORTED_PLATFORMS.includes(probe.platform) || probe.ownPids.includes(input.pid)) return "changed";
  const sockets = await probe.listening();
  if (!sockets.some((socket) => socket.port === input.port && socket.pid === input.pid)) return "changed";
  const cwd = (await probe.cwds([input.pid])).get(input.pid);
  if (cwd === undefined || matchWorkspace(cwd, await matchers(probe, input.workspaces)) === null) return "changed";
  const identity = await probe.identify(input.pid);
  if (identity.startedAt !== input.startedAt) return "changed";
  if (identity.commandLine !== null && isBbCommandLine(identity.commandLine)) return "changed";
  try {
    kill(input.pid, "SIGTERM");
    return "sent";
  } catch {
    return "failed";
  }
}
