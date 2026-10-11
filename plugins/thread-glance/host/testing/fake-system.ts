// A `SystemAccess` that answers from recorded text: command output by command
// line, and files and links by path. What it does not hold fails the way a
// missing command or file does.
import type { SystemAccess } from "../system";

export interface FakeSystemOptions {
  platform: NodeJS.Platform;
  pid?: number;
  ppid?: number;
  /** Output by command line, `file arg arg`. */
  commands?: Record<string, string>;
  /** The text of each file, by path. */
  files?: Record<string, string>;
  /** The names in each directory, by path. */
  dirs?: Record<string, string[]>;
  /** Link targets by path. */
  links?: Record<string, string>;
  /** Real paths by path; a path not listed is its own real path. */
  realpaths?: Record<string, string>;
}

export interface FakeSystem extends SystemAccess {
  /** The command lines run, in order. */
  ran: string[];
  /** The directories listed, in order. */
  listed: string[];
}

export function createFakeSystem(options: FakeSystemOptions): FakeSystem {
  const fake: FakeSystem = {
    platform: options.platform,
    pid: options.pid ?? 900,
    ppid: options.ppid ?? 800,
    ran: [],
    listed: [],
    async run(file, args) {
      const line = [file, ...args].join(" ");
      fake.ran.push(line);
      const output = options.commands?.[line];
      if (output === undefined) throw new Error(`${file} is not installed`);
      return output;
    },
    async readFile(path) {
      const content = options.files?.[path];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    async readdir(path) {
      fake.listed.push(path);
      const names = options.dirs?.[path];
      if (names === undefined) throw new Error("ENOENT");
      return [...names];
    },
    async readlink(path) {
      const target = options.links?.[path];
      if (target === undefined) throw new Error("ENOENT");
      return target;
    },
    async realpath(path) {
      return options.realpaths?.[path] ?? path;
    },
  };
  return fake;
}

/** `/proc/<pid>/stat` for a process that started `ticks` clock ticks after boot (field 22). */
export function procStat(pid: number, comm: string, ticks: number): string {
  return `${pid} (${comm}) S 1 ${pid} ${pid} 0 -1 4194560 1000 0 0 0 10 5 0 0 20 0 11 0 ${ticks} 5000000 1200 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 2 0 0 0 0 0\n`;
}

/** A line of `/proc/net/tcp` for a socket in the given state (`0A` is LISTEN); `addressHex` is as the kernel prints it. */
export function netTcpLine(addressHex: string, port: number, inode: number, state = "0A"): string {
  return `   0: ${addressHex}:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`;
}

const NET_TCP_HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";

/** The text of `/proc/net/tcp` or `/proc/net/tcp6` holding these lines. */
export function netTcp(...lines: string[]): string {
  return `${[NET_TCP_HEADER, ...lines].join("\n")}\n`;
}

/**
 * What `/proc` holds for a process listening on `port` on IPv4 (inode
 * `inode`) and, when `ipv6Inode` is given, on IPv6 loopback too: the socket
 * tables, the process list and the process's fd directory.
 */
export function linuxListener(pid: number, port: number, inode = 9001, ipv6Inode?: number): Pick<FakeSystemOptions, "files" | "dirs" | "links"> {
  return {
    files: {
      "/proc/net/tcp": netTcp(netTcpLine("00000000", port, inode)),
      "/proc/net/tcp6": netTcp(...(ipv6Inode === undefined ? [] : [netTcpLine("00000000000000000000000001000000", port, ipv6Inode)])),
      [`/proc/${pid}/comm`]: "MainThread\n",
    },
    dirs: {
      "/proc": ["1", String(pid), "self", "net"],
      [`/proc/${pid}/fd`]: ["0", "3", "4"],
    },
    links: {
      [`/proc/${pid}/fd/0`]: "/dev/null",
      [`/proc/${pid}/fd/3`]: `socket:[${inode}]`,
      ...(ipv6Inode === undefined ? {} : { [`/proc/${pid}/fd/4`]: `socket:[${ipv6Inode}]` }),
    },
  };
}
