// What the benchmark's scenarios share: starting the fake bb, the host and
// the plugin as processes, talking to them, and evicting a file from the
// page cache.
import { execFileSync, fork } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH = dirname(fileURLToPath(import.meta.url));
export const DATA = join(BENCH, ".data");
export const OUT = join(BENCH, "out");
/** Claude Code's project directory for every benchmark thread: `/work/project`. */
export const SLUG = "-work-project";

/** Every process the benchmark forked; each also exits when its IPC channel to the benchmark closes. */
const children = new Set();
const track = (child) => {
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
};
process.once("exit", () => {
  for (const c of children) c.kill("SIGKILL");
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => process.exit(130));

/** Forks a server script that sends `{ port }` once it listens. */
export function server(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = track(fork(join(BENCH, script), args, { stdio: ["ignore", "inherit", "inherit", "ipc"], env: { ...process.env, ...env } }));
    child.once("message", (m) => resolve({ child, port: m.port }));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`${script} exited with ${code}`)));
  });
}

/** The fake bb over a database file. */
export async function fakeBb(dbPath) {
  const { child, port } = await server("fakebb.mjs", [dbPath]);
  return { child, port, call: (path, body) => post(port, path, body) };
}

/** The host process, reading transcripts under `dir/claude` and background output under `dir/tmp`. */
export async function hostProc(hostEntry, dir) {
  mkdirSync(join(dir, "claude", "projects", SLUG), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  const { child, port } = await server("hostproc.mjs", [hostEntry], { CLAUDE_CONFIG_DIR: join(dir, "claude"), TMPDIR: join(dir, "tmp") });
  return { child, port, stats: () => get(port, "/stats") };
}

/** The plugin process, with the drive clock on. `server` is the bundled server or "noop". */
export function pluginProc(serverPath, config) {
  const child = track(
    fork(join(BENCH, "pluginproc.mjs"), [serverPath, JSON.stringify(config)], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, CACHE_KEEPER_DRIVE_CLOCK: "1" },
    }),
  );
  let next = 0;
  const waiting = new Map();
  const ready = new Promise((resolve) => {
    child.on("message", (m) => {
      if (m.ready) return resolve();
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.ok) w.resolve(m.value);
      else w.reject(new Error(m.error));
    });
  });
  const ask = async (op, args = {}) => {
    await ready;
    return new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      child.send({ id, op, ...args });
    });
  };
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return {
    child,
    ask,
    /** Stops the plugin as bb would on shutdown, and waits for the process to exit. */
    async stop() {
      if (child.exitCode !== null || !child.connected) return;
      await ask("stop").catch(() => {});
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

export async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: JSON.stringify(body ?? null) });
  const out = await res.json();
  if (!res.ok) throw new Error(`${path}: ${out.error}`);
  return out;
}

export async function get(port, path) {
  return (await fetch(`http://127.0.0.1:${port}${path}`)).json();
}

/** Drops a file's pages from the page cache, as a cold read after a reboot would find it. */
export function evict(path) {
  execFileSync("python3", ["-c", `import os\nfd = os.open(${JSON.stringify(path)}, os.O_RDONLY)\nos.fsync(fd)\nos.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)\nos.close(fd)`]);
}

