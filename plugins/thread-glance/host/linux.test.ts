// The host entry against a real process: a node child that listens on a
// loopback port, works in a temporary directory and holds BB_THREAD_ID in its
// environment. Runs on Linux with `lsof` on the PATH.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSystemProbe } from "./probe";
import { scanListeners, signalListener } from "./scan";
import { nodeSystem } from "./system";

const hasLsof = spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;

describe.skipIf(process.platform !== "linux" || !hasLsof)("host entry on Linux, real processes", () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const task of cleanup.splice(0)) task();
  });

  /** Starts a child listening on a loopback port in `cwd` and resolves with it and the port. */
  async function listen(cwd: string, environment: Record<string, string>): Promise<{ child: ChildProcess; port: number }> {
    const child = spawn(
      process.execPath,
      ["-e", "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)});setInterval(()=>{},1000)", "--", "--token=s3cr3t"],
      { cwd, env: { PATH: process.env.PATH, ...environment }, stdio: ["ignore", "pipe", "ignore"] },
    );
    cleanup.push(() => child.kill("SIGKILL"));
    const port = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.stdout?.once("data", (data: Buffer) => resolve(Number(data.toString().trim())));
    });
    return { child, port };
  }

  function workspace(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "tg-ports-")));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  it("finds the listener of a process working in the directory, with its owner, and stops it only for the same start time", async () => {
    const dir = workspace();
    const before = Date.now();
    const { child, port } = await listen(dir, { BB_THREAD_ID: "thr_integration1", TG_TEST_SECRET: "s3cr3t" });
    const probe = createSystemProbe(nodeSystem);

    const reply = await scanListeners(probe, [dir]);
    expect(JSON.stringify(reply)).not.toContain("s3cr3t");
    const found = reply.listeners.find((listener) => listener.port === port);
    expect(found).toMatchObject({ pid: child.pid, workspace: dir, ownerThreadId: "thr_integration1", container: null });
    expect(found?.process).toMatch(/node/);
    expect(found?.startedAt).toBeGreaterThan(before - 5_000);
    expect(found?.startedAt).toBeLessThanOrEqual(Date.now());

    const target = { port, pid: child.pid!, startedAt: found!.startedAt!, workspaces: [dir] };
    expect(await signalListener(probe, process.kill, { ...target, startedAt: target.startedAt + 60_000 })).toBe("changed");
    expect(await signalListener(probe, process.kill, { ...target, workspaces: [workspace()] })).toBe("changed");
    const exited = new Promise((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
    expect(await signalListener(probe, process.kill, target)).toBe("sent");
    expect(await exited).toBe("SIGTERM");
  });

  it("gives no owner for a process with no BB_THREAD_ID, and nothing for another directory", async () => {
    const dir = workspace();
    const { port } = await listen(dir, {});
    const probe = createSystemProbe(nodeSystem);
    const found = (await scanListeners(probe, [dir])).listeners.find((listener) => listener.port === port);
    expect(found?.ownerThreadId).toBeNull();
    expect((await scanListeners(probe, [workspace()])).listeners.find((listener) => listener.port === port)).toBeUndefined();
  });
});
