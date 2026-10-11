import { describe, expect, it, vi } from "vitest";
import { createSystemProbe, type HostProbe } from "./probe";
import { scanListeners, signalListener } from "./scan";
import { createFakeSystem, procStat, type FakeSystemOptions } from "./testing/fake-system";

const SECRET = "s3cr3t";
const BOOT = 1_700_000_000;
const LINUX_STARTED = BOOT * 1_000 + 123_456 * 10;
const LSOF = "lsof -nP -iTCP -sTCP:LISTEN -F pcn +c 0";

/** A dev server in /work/app/web that holds a secret in its environment and its command line. */
function linux(overrides: { environ?: string; stat?: string; extra?: Partial<FakeSystemOptions> } = {}) {
  return createFakeSystem({
    platform: "linux",
    commands: { [LSOF]: "p4242\ncMainThread\nf21\nn*:5173\nf22\nn[::1]:5173\n", ...overrides.extra?.commands },
    files: {
      "/proc/stat": `cpu 1 2 3\nbtime ${BOOT}\n`,
      "/proc/4242/stat": overrides.stat ?? procStat(4242, "node", 123_456),
      "/proc/4242/comm": "MainThread\n",
      "/proc/4242/cmdline": `node\0server.js\0--token=${SECRET}\0`,
      "/proc/4242/environ": overrides.environ ?? `PATH=/bin\0TG_TEST_SECRET=${SECRET}\0BB_THREAD_ID=thr_abc123\0`,
    },
    links: { "/proc/4242/cwd": "/work/app/web", "/proc/4242/exe": "/usr/bin/node" },
    ...overrides.extra,
  });
}

const MAC_STARTED = new Date(2026, 9, 11, 7, 4, 5).getTime();

function macos(environment = `BB_THREAD_ID=thr_abc123 TG_TEST_SECRET=${SECRET}`) {
  const command = `node server.js --token=${SECRET}`;
  return createFakeSystem({
    platform: "darwin",
    commands: {
      [LSOF]: "p4242\ncnode\nf21\nn127.0.0.1:5173\n",
      "lsof -a -d cwd -Fn -p 4242": "p4242\nfcwd\nn/Users/me/work/app/web\n",
      "ps -ww -o lstart=,comm= -p 4242": "Sat Oct 11 07:04:05 2026 /usr/local/bin/node\n",
      "ps -ww -o command= -p 4242": `${command}\n`,
      "ps eww -o command= -p 4242": `${command} PATH=/usr/bin ${environment} HOME=/Users/me\n`,
    },
  });
}

describe("scan on Linux", () => {
  it("lists a listener whose process works inside a workspace, with its owner, process and start", async () => {
    const reply = await scanListeners(createSystemProbe(linux()), ["/work/app"]);
    expect(reply).toEqual({
      supported: true,
      listeners: [
        {
          port: 5173,
          address: "*",
          process: "node",
          pid: 4242,
          startedAt: LINUX_STARTED,
          workspace: "/work/app",
          ownerThreadId: "thr_abc123",
          container: null,
        },
      ],
    });
  });

  it("returns nothing for a workspace the process is not inside, and nothing for a prefix of its name", async () => {
    const probe = createSystemProbe(linux());
    expect((await scanListeners(probe, ["/work/other", "/work/ap", "/elsewhere"])).listeners).toEqual([]);
  });

  it("gives the longest matching workspace, as the request gave it, also through a real path", async () => {
    const system = linux({ extra: { realpaths: { "/home/me/link": "/work/app/web" } } });
    const reply = await scanListeners(createSystemProbe(system), ["/work/app", "/home/me/link"]);
    expect(reply.listeners.map((listener) => listener.workspace)).toEqual(["/home/me/link"]);
  });

  it("gives no owner when the environment holds two BB_THREAD_ID entries", async () => {
    const environ = `BB_THREAD_ID=thr_abc123\0BB_THREAD_ID=thr_other\0TG_TEST_SECRET=${SECRET}\0`;
    const reply = await scanListeners(createSystemProbe(linux({ environ })), ["/work/app"]);
    expect(reply.listeners.map((listener) => listener.ownerThreadId)).toEqual([null]);
  });

  it("gives no owner for a process whose environment cannot be read", async () => {
    const system = linux();
    const probe = createSystemProbe({ ...system, readFile: (path) => (path.endsWith("/environ") ? Promise.reject(new Error("EACCES")) : system.readFile(path)) });
    expect((await scanListeners(probe, ["/work/app"])).listeners.map((listener) => listener.ownerThreadId)).toEqual([null]);
  });

  it("returns nothing of the environment or the command line (AC2)", async () => {
    const reply = await scanListeners(createSystemProbe(linux()), ["/work/app"]);
    expect(JSON.stringify(reply)).not.toContain(SECRET);
    expect(JSON.stringify(reply)).not.toContain("--token");
    expect(JSON.stringify(reply)).not.toContain("TG_TEST_SECRET");
  });

  it("leaves out a process that vanished before its start could be read", async () => {
    const system = linux();
    const probe = createSystemProbe({ ...system, readFile: (path) => (path === "/proc/4242/stat" ? Promise.reject(new Error("ENOENT")) : system.readFile(path)) });
    expect((await scanListeners(probe, ["/work/app"])).listeners).toEqual([]);
  });

  it("skips this worker, its parent, and bb's own processes", async () => {
    const own = createFakeSystem({
      platform: "linux",
      pid: 4242,
      ppid: 1,
      commands: { [LSOF]: "p4242\ncnode\nn*:5173\n" },
      links: { "/proc/4242/cwd": "/work/app" },
    });
    expect((await scanListeners(createSystemProbe(own), ["/work/app"])).listeners).toEqual([]);

    const bbServer = linux({
      extra: { files: { "/proc/stat": `btime ${BOOT}\n`, "/proc/4242/stat": procStat(4242, "node", 1), "/proc/4242/cmdline": "node\0/x/node_modules/bb-app/server/dist/index.js\0" } },
    });
    expect((await scanListeners(createSystemProbe(bbServer), ["/work/app"])).listeners).toEqual([]);
  });

  it("does nothing without workspaces", async () => {
    const system = linux();
    expect(await scanListeners(createSystemProbe(system), [])).toEqual({ supported: true, listeners: [] });
    expect(system.ran).toEqual([]);
  });

  it("rejects without the text of anything it read when lsof is missing", async () => {
    const system = createFakeSystem({ platform: "linux" });
    await expect(scanListeners(createSystemProbe(system), ["/work/app"])).rejects.toThrow("lsof is not installed");
  });
});

describe("scan on macOS", () => {
  it("reads the start from ps, the working directory from lsof and the owner from the environment after the command line", async () => {
    const reply = await scanListeners(createSystemProbe(macos()), ["/Users/me/work/app"]);
    expect(reply).toEqual({
      supported: true,
      listeners: [
        {
          port: 5173,
          address: "127.0.0.1",
          process: "node",
          pid: 4242,
          startedAt: MAC_STARTED,
          workspace: "/Users/me/work/app",
          ownerThreadId: "thr_abc123",
          container: null,
        },
      ],
    });
  });

  it("gives no owner for two entries", async () => {
    const reply = await scanListeners(createSystemProbe(macos("BB_THREAD_ID=thr_a BB_THREAD_ID=thr_b")), ["/Users/me/work/app"]);
    expect(reply.listeners.map((listener) => listener.ownerThreadId)).toEqual([null]);
  });

  it("returns nothing of the environment or the command line (AC2)", async () => {
    const reply = await scanListeners(createSystemProbe(macos()), ["/Users/me/work/app"]);
    expect(JSON.stringify(reply)).not.toContain(SECRET);
    expect(JSON.stringify(reply)).not.toContain("--token");
  });
});

describe("other platforms", () => {
  it("reports an unsupported machine without failing and without reading anything", async () => {
    const system = createFakeSystem({ platform: "win32" });
    expect(await scanListeners(createSystemProbe(system), ["C:\\work"])).toEqual({ supported: false, listeners: [] });
    expect(system.ran).toEqual([]);
  });
});

describe("Docker", () => {
  const dockerLine = `docker ps --format ${'{"name":{{json .Names}},"ports":{{json .Ports}},"dir":{{json (.Label "com.docker.compose.project.working_dir")}}}'}`;
  const web = JSON.stringify({ name: "app-web-1", ports: "0.0.0.0:8080->80/tcp, 0.0.0.0:5173->5173/tcp", dir: "/work/app" });
  const elsewhere = JSON.stringify({ name: "other-1", ports: "0.0.0.0:9090->90/tcp", dir: "/srv/other" });

  it("adds a port with no process and sets the container of a port a process already serves", async () => {
    const system = linux({ extra: { commands: { [LSOF]: "p4242\ncnode\nn*:5173\n", [dockerLine]: `${web}\n${elsewhere}\n` } } });
    const reply = await scanListeners(createSystemProbe(system), ["/work/app"]);
    const byPort = new Map(reply.listeners.map((listener) => [listener.port, listener]));
    expect(byPort.get(5173)).toMatchObject({ pid: 4242, ownerThreadId: "thr_abc123", container: "app-web-1" });
    expect(byPort.get(8080)).toEqual({
      port: 8080,
      address: "0.0.0.0",
      process: null,
      pid: null,
      startedAt: null,
      workspace: "/work/app",
      ownerThreadId: null,
      container: "app-web-1",
    });
    expect(byPort.has(9090)).toBe(false);
  });

  it("adds nothing and fails nothing when docker is absent", async () => {
    const reply = await scanListeners(createSystemProbe(linux()), ["/work/app"]);
    expect(reply.listeners).toHaveLength(1);
  });
});

describe("signal", () => {
  const input = { port: 5173, pid: 4242, startedAt: LINUX_STARTED, workspaces: ["/work/app"] };
  const probe = (system = linux()): HostProbe => createSystemProbe(system);

  it("sends SIGTERM to the process that still listens with that PID and start time inside a workspace", async () => {
    const kill = vi.fn();
    expect(await signalListener(probe(), kill, input)).toBe("sent");
    expect(kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGTERM");
  });

  it("signals nothing when the PID was reused by a process that started later (AC4)", async () => {
    const kill = vi.fn();
    expect(await signalListener(probe(), kill, { ...input, startedAt: LINUX_STARTED - 5_000 })).toBe("changed");
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals nothing when another process listens on the port now", async () => {
    const kill = vi.fn();
    expect(await signalListener(probe(), kill, { ...input, pid: 999 })).toBe("changed");
    expect(await signalListener(probe(), kill, { ...input, port: 3000 })).toBe("changed");
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals nothing for a listener outside every workspace (AC4)", async () => {
    const kill = vi.fn();
    expect(await signalListener(probe(), kill, { ...input, workspaces: ["/work/other", "/work/ap"] })).toBe("changed");
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals nothing for bb's own processes or this worker", async () => {
    const kill = vi.fn();
    const own = createFakeSystem({ platform: "linux", pid: 4242, commands: { [LSOF]: "p4242\ncnode\nn*:5173\n" }, links: { "/proc/4242/cwd": "/work/app" } });
    expect(await signalListener(createSystemProbe(own), kill, input)).toBe("changed");
    expect(kill).not.toHaveBeenCalled();
  });

  it("reports a failed signal", async () => {
    const kill = vi.fn(() => {
      throw new Error("EPERM");
    });
    expect(await signalListener(probe(), kill, input)).toBe("failed");
  });

  it("matches a macOS process by its ps start time", async () => {
    const kill = vi.fn();
    const mac = { port: 5173, pid: 4242, startedAt: MAC_STARTED, workspaces: ["/Users/me/work/app"] };
    expect(await signalListener(createSystemProbe(macos()), kill, mac)).toBe("sent");
    expect(await signalListener(createSystemProbe(macos()), kill, { ...mac, startedAt: MAC_STARTED + 1_000 })).toBe("changed");
    expect(kill).toHaveBeenCalledOnce();
  });
});
