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
  /** File contents by path. */
  files?: Record<string, string>;
  /** Link targets by path. */
  links?: Record<string, string>;
  /** Real paths by path; a path not listed is its own real path. */
  realpaths?: Record<string, string>;
}

export interface FakeSystem extends SystemAccess {
  /** The command lines run, in order. */
  ran: string[];
}

export function createFakeSystem(options: FakeSystemOptions): FakeSystem {
  const fake: FakeSystem = {
    platform: options.platform,
    pid: options.pid ?? 900,
    ppid: options.ppid ?? 800,
    ran: [],
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
