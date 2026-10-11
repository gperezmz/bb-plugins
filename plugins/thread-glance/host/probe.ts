// What the host entry reads from the machine: the one place it runs commands
// and reads `/proc`. `HostProbe` is the port the scan and the signal work on;
// `createSystemProbe` is the real adapter for Linux and macOS.
//
// The environment of a process is read only inside `ownerOf`, which returns
// the single `BB_THREAD_ID` value and nothing else. No command's output or
// failure text is passed on: a failure names the command and why it failed.
import {
  DOCKER_PS_FORMAT,
  executableName,
  ownerFromEnviron,
  ownerFromPsEnvironment,
  parseBootTime,
  parseDockerPs,
  parseLsofCwds,
  parseLsofListeners,
  parseProcStart,
  parsePsStart,
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
  /** Every listening TCP socket the machine shows. Rejects when the system cannot list them. */
  listening(): Promise<RawListener[]>;
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
const LSOF_ARGS = ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn", "+c", "0"];

export function createSystemProbe(system: SystemAccess): HostProbe {
  const { platform, run } = system;
  let bootTime: Promise<number | null> | null = null;
  const readBootTime = () => (bootTime ??= system.readFile("/proc/stat").then(parseBootTime, () => null));
  const attempt = <T>(read: Promise<T>): Promise<T | null> => read.catch(() => null);

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
    async listening() {
      return parseLsofListeners(await run("lsof", LSOF_ARGS));
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
