// What the host entry reads from the machine: the one place it runs commands
// and reads `/proc`. `HostProbe` is the port the scan and the signal work on;
// `createSystemProbe` is the real adapter for Linux and macOS.
//
// The environment of a process is read only inside `ownerOf`, which returns
// the single `BB_THREAD_ID` value and nothing else. No command's output or
// failure text is passed on: a failure names the command and why it failed.
import { inBatches } from "../shared/batches";
import {
  DOCKER_PS_FORMAT,
  executableName,
  ownerFromEnviron,
  ownerFromPsEnvironment,
  parseBootTime,
  parseDockerPs,
  parseLsofCwds,
  parseLsofListeners,
  parseProcNetTcp,
  parseProcStart,
  parsePsStart,
  socketInode,
  type DockerPort,
  type RawListener,
} from "./parse";
import type { SystemAccess } from "./system";

/** What the host knows of a process that listens. */
export interface ProcessIdentity {
  /** When it started, epoch ms; null when it cannot be read. */
  startedAt: number | null;
  /** The executable's name; null when it cannot be read. */
  executable: string | null;
  /** Only to tell bb's own processes apart; never returned. */
  commandLine: string | null;
}

export interface HostProbe {
  platform: NodeJS.Platform;
  /** Processes whose listeners are never reported: this worker and its parent, the host daemon. */
  ownPids: readonly number[];
  /**
   * Every listening TCP socket the machine shows, with the process holding it:
   * on Linux from `/proc/net/tcp*` and the sockets in `/proc/<pid>/fd` (a
   * process whose fd directory is unreadable is skipped), on macOS from `lsof`.
   * Linux does not use `lsof`: many machines lack it, and a machine that cannot
   * be scanned hides its ports and holds back every auto-settle candidate.
   * With `pid`, only that process's sockets, without looking at any other
   * process. Rejects when the system cannot list them.
   */
  listening(pid?: number): Promise<RawListener[]>;
  /** The working directory of each of `pids` it can read. */
  cwds(pids: readonly number[]): Promise<Map<number, string>>;
  identify(pid: number): Promise<ProcessIdentity>;
  /** The thread named by the process's single `BB_THREAD_ID` entry; null when it has none, several, or cannot be read. */
  ownerOf(pid: number, commandLine: string | null): Promise<string | null>;
  /** The real path of `path`, or null when it cannot be resolved. */
  realpath(path: string): Promise<string | null>;
  /** Published ports of Docker containers with a compose working directory; empty when Docker is absent or fails. */
  docker(): Promise<DockerPort[]>;
}

const DOCKER_TIMEOUT_MS = 3_000;
/** Processes whose fd directories are read at once. */
const FD_SCAN_CONCURRENCY = 16;
const LSOF_ARGS = ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn", "+c", "0"];

export function createSystemProbe(system: SystemAccess): HostProbe {
  const { platform, run } = system;
  let bootTime: Promise<number | null> | null = null;
  const readBootTime = () => (bootTime ??= system.readFile("/proc/stat").then(parseBootTime, () => null));
  const attempt = <T>(read: Promise<T>): Promise<T | null> => read.catch(() => null);

  /** The processes among `pids` that hold each of `inodes`, found through the `socket:[inode]` links in their fd directories. */
  async function socketHolders(inodes: ReadonlySet<number>, pids: readonly number[]): Promise<Map<number, number[]>> {
    const holders = new Map<number, number[]>();
    await inBatches(pids, FD_SCAN_CONCURRENCY, async (pid) => {
      if (holders.size >= inodes.size) return;
      const fds = await attempt(system.readdir(`/proc/${pid}/fd`));
      if (fds === null) return;
      await Promise.all(
        fds.map(async (fd) => {
          const target = await attempt(system.readlink(`/proc/${pid}/fd/${fd}`));
          const inode = target === null ? null : socketInode(target);
          if (inode === null || !inodes.has(inode)) return;
          const pidsOfInode = holders.get(inode) ?? [];
          if (!pidsOfInode.includes(pid)) pidsOfInode.push(pid);
          holders.set(inode, pidsOfInode);
        }),
      );
    });
    return holders;
  }

  async function linuxListening(only?: number): Promise<RawListener[]> {
    const [v4, v6] = await Promise.all([attempt(system.readFile("/proc/net/tcp")), attempt(system.readFile("/proc/net/tcp6"))]);
    if (v4 === null && v6 === null) throw new Error("/proc/net/tcp is not readable");
    const sockets = [...parseProcNetTcp(v4 ?? ""), ...parseProcNetTcp(v6 ?? "")];
    if (sockets.length === 0) return [];
    const pids =
      only !== undefined ? [only] : (await system.readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
    const holders = await socketHolders(new Set(sockets.map((socket) => socket.inode)), pids);
    const names = new Map<number, string>();
    const found = new Map<string, RawListener>();
    for (const socket of sockets) {
      for (const pid of holders.get(socket.inode) ?? []) {
        const key = `${pid}:${socket.port}`;
        if (found.has(key)) continue;
        if (!names.has(pid)) names.set(pid, ((await attempt(system.readFile(`/proc/${pid}/comm`))) ?? "").trim());
        found.set(key, { pid, command: names.get(pid) ?? "", address: socket.address, port: socket.port });
      }
    }
    return [...found.values()];
  }

  const linuxIdentity = async (pid: number): Promise<ProcessIdentity> => {
    const [stat, boot, exe, comm, cmdline] = await Promise.all([
      attempt(system.readFile(`/proc/${pid}/stat`)),
      readBootTime(),
      attempt(system.readlink(`/proc/${pid}/exe`)),
      attempt(system.readFile(`/proc/${pid}/comm`)),
      attempt(system.readFile(`/proc/${pid}/cmdline`)),
    ]);
    return {
      startedAt: stat === null || boot === null ? null : parseProcStart(stat, boot),
      executable: exe !== null ? executableName(exe) : comm !== null ? comm.trim() : null,
      commandLine: cmdline === null ? null : cmdline.split("\0").join(" ").trim(),
    };
  };

  const macIdentity = async (pid: number): Promise<ProcessIdentity> => {
    const [started, command] = await Promise.all([
      run("ps", ["-ww", "-o", "lstart=,comm=", "-p", String(pid)]).catch(() => ""),
      run("ps", ["-ww", "-o", "command=", "-p", String(pid)]).catch(() => ""),
    ]);
    const parsed = parsePsStart(started.split("\n")[0] ?? "");
    return {
      startedAt: parsed === null ? null : parsed.startedAt,
      executable: parsed === null || parsed.executable === "" ? null : executableName(parsed.executable),
      commandLine: command.trim() === "" ? null : command.trim(),
    };
  };

  return {
    platform,
    ownPids: [system.pid, system.ppid],
    async listening(pid) {
      if (platform === "linux") return linuxListening(pid);
      return parseLsofListeners(await run("lsof", pid === undefined ? LSOF_ARGS : [...LSOF_ARGS, "-a", "-p", String(pid)]));
    },
    async cwds(pids) {
      if (pids.length === 0) return new Map();
      if (platform === "linux") {
        const found = new Map<number, string>();
        await Promise.all(
          pids.map(async (pid) => {
            const cwd = await attempt(system.readlink(`/proc/${pid}/cwd`));
            if (cwd !== null) found.set(pid, cwd);
          }),
        );
        return found;
      }
      return parseLsofCwds(await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")]).catch(() => ""));
    },
    identify: (pid) => (platform === "linux" ? linuxIdentity(pid) : macIdentity(pid)),
    async ownerOf(pid, commandLine) {
      try {
        if (platform === "linux") return ownerFromEnviron(await system.readFile(`/proc/${pid}/environ`));
        if (commandLine === null) return null;
        return ownerFromPsEnvironment(await run("ps", ["eww", "-o", "command=", "-p", String(pid)]), commandLine);
      } catch {
        return null;
      }
    },
    realpath: (path) => attempt(system.realpath(path)),
    async docker() {
      try {
        return parseDockerPs(await run("docker", ["ps", "--format", DOCKER_PS_FORMAT], { timeoutMs: DOCKER_TIMEOUT_MS, fullEnvironment: true }));
      } catch {
        return [];
      }
    },
  };
}
