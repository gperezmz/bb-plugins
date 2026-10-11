// Parsers for what the host entry reads from the system: `lsof -F`, `/proc`,
// `ps` and `docker ps`. Pure: each takes text and returns data, so the
// Linux and macOS outputs are tested as recorded text.
import { THREAD_ID_PATTERN } from "../shared/ports";

/** A listening TCP socket as `lsof` reports it. */
export interface RawListener {
  pid: number;
  /** The command name lsof prints; the fallback when nothing better names the executable. */
  command: string;
  /** The address as lsof prints it: `127.0.0.1`, `[::1]`, `*`. */
  address: string;
  port: number;
}

/** A published port of a running Docker container that has a compose working directory. */
export interface DockerPort {
  container: string;
  workingDir: string;
  address: string;
  port: number;
}

const MAX_RANGE = 64;

/** Splits `host:port` at the last colon; null when the port is not a number. */
function splitName(name: string): { address: string; port: number } | null {
  const colon = name.lastIndexOf(":");
  if (colon < 0) return null;
  const port = Number(name.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { address: name.slice(0, colon), port };
}

/**
 * Reads `lsof -nP -iTCP -sTCP:LISTEN -F pcn` output: a `p` line starts a
 * process, `c` names its command, and each `n` line is one socket. A socket
 * both IPv4 and IPv6 listeners report is listed once per process and port.
 */
export function parseLsofListeners(output: string): RawListener[] {
  const found = new Map<string, RawListener>();
  let pid: number | null = null;
  let command = "";
  for (const line of output.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const next = Number(value);
      pid = Number.isInteger(next) && next > 0 ? next : null;
      command = "";
    } else if (tag === "c") {
      command = value;
    } else if (tag === "n" && pid !== null) {
      const name = splitName(value);
      if (name === null) continue;
      const key = `${pid}:${name.port}`;
      if (!found.has(key)) found.set(key, { pid, command, address: name.address, port: name.port });
    }
  }
  return [...found.values()];
}

/** A listening socket as `/proc/net/tcp` and `/proc/net/tcp6` list it. */
export interface ProcNetSocket {
  address: string;
  port: number;
  /** The socket's inode, which `/proc/<pid>/fd/<n>` links name as `socket:[inode]`. */
  inode: number;
}

/** Eight hextets of 16 bits to the shortest IPv6 text, with `::` for the longest run of zeros. */
function ipv6Text(hextets: readonly number[]): string {
  let best = { start: -1, length: 0 };
  for (let start = 0; start < 8; start++) {
    let length = 0;
    while (start + length < 8 && hextets[start + length] === 0) length++;
    if (length > best.length) best = { start, length };
  }
  const hex = (values: readonly number[]) => values.map((value) => value.toString(16)).join(":");
  if (best.length < 2) return hex(hextets);
  return `${hex(hextets.slice(0, best.start))}::${hex(hextets.slice(best.start + best.length))}`;
}

/**
 * An address from the hex `/proc/net/tcp` prints, written the way lsof prints
 * it: `*` for any IPv4 address, `[::]` for any IPv6 one, `[::1]`, a dotted
 * IPv4 address (also when IPv6-mapped). The kernel prints each 32-bit word in
 * host byte order; the supported machines are little-endian.
 */
export function procNetAddress(hex: string): string | null {
  const bytes = hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16));
  if (bytes === undefined || bytes.some((byte) => Number.isNaN(byte))) return null;
  const network = (word: number) => bytes.slice(word * 4, word * 4 + 4).reverse();
  if (bytes.length === 4) {
    const octets = network(0);
    return octets.every((octet) => octet === 0) ? "*" : octets.join(".");
  }
  if (bytes.length !== 16) return null;
  const octets = [0, 1, 2, 3].flatMap(network);
  if (octets.slice(0, 10).every((octet) => octet === 0) && octets[10] === 0xff && octets[11] === 0xff) return octets.slice(12).join(".");
  const text = ipv6Text(Array.from({ length: 8 }, (_, index) => octets[index * 2] * 256 + octets[index * 2 + 1]));
  return `[${text}]`;
}

/**
 * The sockets in LISTEN state (`0A`) of `/proc/net/tcp` or `/proc/net/tcp6`
 * text. A line that does not parse is skipped.
 */
export function parseProcNetTcp(text: string): ProcNetSocket[] {
  const sockets: ProcNetSocket[] = [];
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== "0A") continue;
    const [addressHex, portHex] = fields[1].split(":");
    const address = procNetAddress(addressHex ?? "");
    const port = Number.parseInt(portHex ?? "", 16);
    const inode = Number(fields[9]);
    if (address === null || !Number.isInteger(port) || port < 1 || port > 65_535 || !Number.isInteger(inode) || inode <= 0) continue;
    sockets.push({ address, port, inode });
  }
  return sockets;
}

/** The inode of a `/proc/<pid>/fd/<n>` link's target `socket:[12345]`; null for any other target. */
export function socketInode(linkTarget: string): number | null {
  const match = /^socket:\[(\d+)\]$/.exec(linkTarget);
  return match === null ? null : Number(match[1]);
}

/** Reads `lsof -a -d cwd -Fn` output into the working directory of each process it lists. */
export function parseLsofCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line[0] === "p") {
      const next = Number(line.slice(1));
      pid = Number.isInteger(next) && next > 0 ? next : null;
    } else if (line[0] === "n" && pid !== null && !cwds.has(pid)) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/** The boot time, in epoch seconds, from `/proc/stat`; null when it has no `btime` line. */
export function parseBootTime(procStat: string): number | null {
  const match = /^btime\s+(\d+)$/m.exec(procStat);
  return match === null ? null : Number(match[1]);
}

/** Clock ticks per second `/proc/<pid>/stat` counts in. Node cannot ask `sysconf`, and Linux builds fix it at 100 for user space. */
export const CLOCK_TICKS_PER_SECOND = 100;

/**
 * When a process started, epoch ms, from the text of `/proc/<pid>/stat` and
 * the boot time. Field 22 is the start in clock ticks after boot; the command
 * name (field 2) sits in parentheses and may hold spaces and parentheses, so
 * the fields are counted after the last `)`.
 */
export function parseProcStart(procPidStat: string, bootTimeSeconds: number): number | null {
  const close = procPidStat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = procPidStat.slice(close + 1).trim().split(/\s+/);
  // After the command name the fields begin at field 3 (the state).
  const ticks = Number(fields[22 - 3]);
  if (!Number.isFinite(ticks)) return null;
  return bootTimeSeconds * 1_000 + Math.round((ticks * 1_000) / CLOCK_TICKS_PER_SECOND);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Reads one line of `ps -o lstart=,comm= -p <pid>` in the C locale
 * (`Sat Oct 11 07:04:05 2026 /usr/bin/node`): the start in local time as epoch
 * ms, and the executable path that follows it. The start has one-second
 * resolution, which is all a reused PID needs.
 */
export function parsePsStart(line: string): { startedAt: number; executable: string } | null {
  const match = /^\s*[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*(.*)$/.exec(line.trim());
  if (match === null) return null;
  const month = MONTHS.indexOf(match[1]);
  if (month < 0) return null;
  const startedAt = new Date(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return { startedAt, executable: match[7].trim() };
}

/** The last path segment, without the " (deleted)" a replaced Linux executable carries. */
export function executableName(path: string): string {
  const trimmed = path.replace(/ \(deleted\)$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

const OWNER_ENTRY = "BB_THREAD_ID=";

/** The thread id when `values` holds exactly one `BB_THREAD_ID=` entry with a thread id as its value. */
function singleOwner(values: readonly string[]): string | null {
  const entries = values.filter((value) => value.startsWith(OWNER_ENTRY));
  if (entries.length !== 1) return null;
  const id = entries[0].slice(OWNER_ENTRY.length);
  return THREAD_ID_PATTERN.test(id) ? id : null;
}

/**
 * The owner from `/proc/<pid>/environ` text (entries split on NUL). Returns
 * the single `BB_THREAD_ID` value and nothing else of the environment.
 */
export function ownerFromEnviron(environ: string): string | null {
  return singleOwner(environ.split("\0"));
}

/**
 * The owner from `ps eww -o command= -p <pid>` output, which prints the
 * command line followed by the environment as space-separated entries.
 * `commandLine` (`ps -ww -o command=`, same process) is stripped off the
 * front first so an argument that looks like an entry is not counted; when it
 * is not the front of `full`, there is no owner. Returns the single
 * `BB_THREAD_ID` value and nothing else of either text.
 */
export function ownerFromPsEnvironment(full: string, commandLine: string): string | null {
  const command = commandLine.trim();
  const text = full.trim();
  if (command === "" || !text.startsWith(command)) return null;
  const rest = text.slice(command.length);
  if (rest !== "" && !/^\s/.test(rest)) return null;
  return singleOwner(rest.split(/\s+/).filter((entry) => entry !== ""));
}

/**
 * The published TCP ports of `docker ps` output rendered with
 * {@link DOCKER_PS_FORMAT}: one JSON object per line. A container without a
 * compose working directory, or a malformed line, adds nothing.
 */
export function parseDockerPs(output: string): DockerPort[] {
  const found: DockerPort[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const { name, ports, dir } = (value ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof ports !== "string" || typeof dir !== "string" || dir === "") continue;
    for (const published of ports.split(",")) {
      // `0.0.0.0:8080->80/tcp`, `:::8080->80/tcp`, `127.0.0.1:3000-3002->3000-3002/tcp`
      const match = /^\s*(.*):(\d+)(?:-(\d+))?->[^/]+\/tcp\s*$/.exec(published);
      if (match === null) continue;
      const address = match[1];
      const first = Number(match[2]);
      const last = match[3] === undefined ? first : Number(match[3]);
      for (let port = first; port <= last && port < first + MAX_RANGE; port++) {
        if (port >= 1 && port <= 65_535) found.push({ container: name, workingDir: dir, address, port });
      }
    }
  }
  return found;
}

/** The `--format` that makes `docker ps` print only the name, the published ports and the compose working directory, as JSON lines. */
export const DOCKER_PS_FORMAT =
  '{"name":{{json .Names}},"ports":{{json .Ports}},"dir":{{json (.Label "com.docker.compose.project.working_dir")}}}';

/**
 * Whether the command line is bb's own: its server, host daemon or a plugin
 * worker. Their listeners are never a thread's.
 */
export function isBbCommandLine(commandLine: string): boolean {
  return /[\\/]node_modules[\\/]bb-app[\\/]/.test(commandLine) || /bb-(?:plugin-host|provider-bridge)-worker/.test(commandLine);
}
