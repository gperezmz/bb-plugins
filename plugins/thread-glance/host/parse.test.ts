import { describe, expect, it } from "vitest";
import {
  executableName,
  isBbCommandLine,
  ownerFromEnviron,
  ownerFromPsEnvironment,
  parseBootTime,
  parseDockerPs,
  parseLsofCwds,
  parseLsofListeners,
  parseProcNetTcp,
  procNetAddress,
  socketInode,
  parseProcStart,
  parsePsStart,
} from "./parse";
import { netTcp, netTcpLine, procStat } from "./testing/fake-system";

describe("parseLsofListeners", () => {
  it("reads one socket per process and port, whichever address family lists it first", () => {
    const output = [
      "p1234", "cnode", "f21", "n*:5173", "f22", "n[::1]:5173",
      "p2000", "cpostgres", "f5", "n127.0.0.1:5432", "f6", "n[::1]:5432",
      "p3000", "cdocker-proxy", "f7", "n[::]:8080",
      "",
    ].join("\n");
    expect(parseLsofListeners(output)).toEqual([
      { pid: 1234, command: "node", address: "*", port: 5173 },
      { pid: 2000, command: "postgres", address: "127.0.0.1", port: 5432 },
      { pid: 3000, command: "docker-proxy", address: "[::]", port: 8080 },
    ]);
  });

  it("ignores names that carry no port and processes without an id", () => {
    expect(parseLsofListeners("pabc\ncnode\nn*:80\np5\ncx\nn/tmp/sock\nn*:99999\n")).toEqual([]);
    expect(parseLsofListeners("")).toEqual([]);
  });

  it("keeps two processes that share a port", () => {
    expect(parseLsofListeners("p1\nca\nn*:80\np2\ncb\nn*:80\n").map((listener) => listener.pid)).toEqual([1, 2]);
  });
});

describe("/proc/net/tcp", () => {
  it("writes addresses the way lsof does", () => {
    expect(procNetAddress("0100007F")).toBe("127.0.0.1");
    expect(procNetAddress("00000000")).toBe("*");
    expect(procNetAddress("0A14A8C0")).toBe("192.168.20.10");
    expect(procNetAddress("00000000000000000000000000000000")).toBe("[::]");
    expect(procNetAddress("00000000000000000000000001000000")).toBe("[::1]");
    expect(procNetAddress("0000000000000000FFFF00000100007F")).toBe("127.0.0.1");
    expect(procNetAddress("B80D0120000000000000000001000000")).toBe("[2001:db8::1]");
    expect(procNetAddress("zz")).toBeNull();
    expect(procNetAddress("0100")).toBeNull();
  });

  it("lists sockets in LISTEN state, with their port and inode", () => {
    const text = netTcp(
      netTcpLine("0100007F", 5173, 111),
      netTcpLine("00000000", 80, 222, "01"),
      netTcpLine("00000000000000000000000001000000", 3000, 333),
      "garbage line",
    );
    expect(parseProcNetTcp(text)).toEqual([
      { address: "127.0.0.1", port: 5173, inode: 111 },
      { address: "[::1]", port: 3000, inode: 333 },
    ]);
    expect(parseProcNetTcp("")).toEqual([]);
  });

  it("reads the inode of a socket link and nothing else", () => {
    expect(socketInode("socket:[12345]")).toBe(12345);
    expect(socketInode("/dev/null")).toBeNull();
    expect(socketInode("pipe:[12345]")).toBeNull();
    expect(socketInode("anon_inode:[eventpoll]")).toBeNull();
  });
});

describe("parseLsofCwds", () => {
  it("maps each process to its working directory", () => {
    expect(parseLsofCwds("p10\nfcwd\nn/Users/me/work\np11\nfcwd\nn/tmp/a b\n")).toEqual(
      new Map([
        [10, "/Users/me/work"],
        [11, "/tmp/a b"],
      ]),
    );
  });
});

describe("Linux process times", () => {
  it("reads the boot time", () => {
    expect(parseBootTime("cpu  1 2 3\nbtime 1700000000\nprocesses 5\n")).toBe(1_700_000_000);
    expect(parseBootTime("cpu 1\n")).toBeNull();
  });

  it("reads field 22 of /proc/<pid>/stat as ticks after boot", () => {
    expect(parseProcStart(procStat(42, "node", 123_456), 1_700_000_000)).toBe(1_700_000_000_000 + 1_234_560);
  });

  it("counts fields after the last parenthesis, whatever the command name holds", () => {
    expect(parseProcStart(procStat(42, "a) S 1 (b c", 500), 10)).toBe(10_000 + 5_000);
    expect(parseProcStart("garbage", 10)).toBeNull();
  });
});

describe("parsePsStart", () => {
  it("reads lstart in local time, with a padded day, and the executable after it", () => {
    expect(parsePsStart("Sat Oct 11 07:04:05 2026 /usr/local/bin/node\n")).toEqual({
      startedAt: new Date(2026, 9, 11, 7, 4, 5).getTime(),
      executable: "/usr/local/bin/node",
    });
    expect(parsePsStart("Mon Jan  5 23:59:59 2026 -zsh")?.startedAt).toBe(new Date(2026, 0, 5, 23, 59, 59).getTime());
    expect(parsePsStart("not a date")).toBeNull();
    expect(parsePsStart("")).toBeNull();
  });
});

describe("executableName", () => {
  it("keeps the last segment and drops the marker of a replaced executable", () => {
    expect(executableName("/usr/bin/node")).toBe("node");
    expect(executableName("/opt/app/bin/server (deleted)")).toBe("server");
    expect(executableName("node")).toBe("node");
  });
});

describe("ownership", () => {
  it("reads the single BB_THREAD_ID of /proc/<pid>/environ", () => {
    expect(ownerFromEnviron("PATH=/bin\0BB_THREAD_ID=thr_abc123\0HOME=/root\0")).toBe("thr_abc123");
  });

  it("gives no owner for two entries, none, or a value that is not a thread id", () => {
    expect(ownerFromEnviron("BB_THREAD_ID=thr_a\0BB_THREAD_ID=thr_b\0")).toBeNull();
    expect(ownerFromEnviron("BB_THREAD_ID=thr_a\0BB_THREAD_ID=thr_a\0")).toBeNull();
    expect(ownerFromEnviron("PATH=/bin\0")).toBeNull();
    expect(ownerFromEnviron("BB_THREAD_ID=not-a-thread\0")).toBeNull();
    expect(ownerFromEnviron("BB_THREAD_ID=\0")).toBeNull();
    expect(ownerFromEnviron("XBB_THREAD_ID=thr_a\0")).toBeNull();
  });

  it("reads the owner of `ps eww` output after stripping the command line", () => {
    const command = "node server.js --token=s3cr3t";
    expect(ownerFromPsEnvironment(`${command} PATH=/bin BB_THREAD_ID=thr_abc123 HOME=/Users/me`, command)).toBe("thr_abc123");
  });

  it("does not count an argument that looks like an entry", () => {
    const command = "node server.js BB_THREAD_ID=thr_arg";
    expect(ownerFromPsEnvironment(`${command} BB_THREAD_ID=thr_real`, command)).toBe("thr_real");
    expect(ownerFromPsEnvironment(`${command} PATH=/bin`, command)).toBeNull();
  });

  it("gives no owner for two entries, or when the command line is not the front of the output", () => {
    const command = "node a.js";
    expect(ownerFromPsEnvironment(`${command} BB_THREAD_ID=thr_a BB_THREAD_ID=thr_b`, command)).toBeNull();
    expect(ownerFromPsEnvironment("other BB_THREAD_ID=thr_a", command)).toBeNull();
    expect(ownerFromPsEnvironment("node a.jsx BB_THREAD_ID=thr_a", command)).toBeNull();
    expect(ownerFromPsEnvironment("anything", "")).toBeNull();
  });
});

describe("parseDockerPs", () => {
  const line = (name: string, ports: string, dir: string) => JSON.stringify({ name, ports, dir });

  it("lists published TCP ports of containers with a compose working directory", () => {
    const output = [
      line("web", "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 127.0.0.1:5433->5432/tcp", "/work/app"),
      line("range", "0.0.0.0:3000-3002->3000-3002/tcp", "/work/app"),
      line("udp", "0.0.0.0:53->53/udp", "/work/app"),
      line("plain", "0.0.0.0:9000->9000/tcp", ""),
      line("unpublished", "80/tcp", "/work/app"),
      "not json",
      "",
    ].join("\n");
    expect(parseDockerPs(output).map(({ container, address, port }) => `${container} ${address} ${port}`)).toEqual([
      "web 0.0.0.0 8080",
      "web :: 8080",
      "web 127.0.0.1 5433",
      "range 0.0.0.0 3000",
      "range 0.0.0.0 3001",
      "range 0.0.0.0 3002",
    ]);
  });
});

describe("isBbCommandLine", () => {
  it("recognises bb's server, host daemon and workers", () => {
    expect(isBbCommandLine("/usr/bin/node /home/me/.mise/bb-app@0.46.0/node_modules/bb-app/server/dist/index.js")).toBe(true);
    expect(isBbCommandLine("node /x/node_modules/bb-app/host-daemon/dist/bb-plugin-host-worker.mjs /data")).toBe(true);
    expect(isBbCommandLine("node bb-plugin-host-worker.mjs")).toBe(true);
    expect(isBbCommandLine("node server.js")).toBe(false);
    expect(isBbCommandLine("node ./node_modules/vite/bin/vite.js")).toBe(false);
  });
});
