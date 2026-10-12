import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execCli, ExecCliLogins, ghLoginsIn, glabTokenIn, loginsInText, type RunCli } from "./credentials";

const recording = (answer: (command: string, args: string[]) => Promise<string>) => {
  const calls: [string, string[]][] = [];
  const run: RunCli = (command, args) => {
    calls.push([command, args]);
    return answer(command, args);
  };
  return { logins: new ExecCliLogins(run), calls };
};

describe("ExecCliLogins", () => {
  it("lists gh's logins for a host from its JSON status", async () => {
    const json = JSON.stringify({ hosts: { "github.com": [{ login: "yuser", active: true }, { login: "buser", active: false }], "ghe.example.com": [{ login: "other" }] } });
    const { logins, calls } = recording(async () => json);
    expect(await logins.logins("gh", "github.com")).toEqual(["yuser", "buser"]);
    expect(calls).toEqual([["gh", ["auth", "status", "--hostname", "github.com", "--json", "hosts"]]]);
  });

  it("reads an older gh's status text when it has no JSON", async () => {
    const { logins } = recording(async (_, args) => (args.includes("--json") ? Promise.reject(new Error("gh failed")) : "github.com\n  ✓ Logged in to github.com account yuser (keyring)\n  ✓ Logged in to github.com account buser (keyring)\n"));
    expect(await logins.logins("gh", "github.com")).toEqual(["yuser", "buser"]);
  });

  it("reads glab's one login for a host, and none where it holds none", async () => {
    expect(await recording(async () => "gitlab.example.com\n  ✓ Logged in to gitlab.example.com as yuser (config)\n").logins.logins("glab", "gitlab.example.com")).toEqual(["yuser"]);
    expect(await recording(async () => Promise.reject(new Error("glab failed"))).logins.logins("glab", "gitlab.example.com")).toEqual([]);
  });

  it("asks gh for the chosen login's token on the host, and trims it", async () => {
    const { logins, calls } = recording(async () => "gho_b\n");
    expect(await logins.token("gh", "github.com", "buser")).toBe("gho_b");
    expect(calls).toEqual([["gh", ["auth", "token", "--hostname", "github.com", "--user", "buser"]]]);
  });

  it("reads glab's token from its status text, and rejects naming neither output nor error when there is none", async () => {
    expect(await recording(async () => "✓ Token found in keyring: glpat-1\n").logins.token("glab", "gitlab.com", "yuser")).toBe("glpat-1");
    const failed = await recording(async () => "Token: ****\n").logins.token("glab", "gitlab.com", "yuser").then(() => new Error("no refusal"), (error: unknown) => error as Error);
    expect(failed.message).toBe("glab gave no token for yuser on gitlab.com");
    const thrown = await recording(async () => Promise.reject(new Error("gho_leaked"))).logins.token("gh", "github.com", "yuser").then(() => new Error("no refusal"), (error: unknown) => error as Error);
    expect(thrown.message).not.toContain("gho_leaked");
  });

  it("takes no login from output that names another host", () => {
    expect(loginsInText("✓ Logged in to github.com.evil.net account yuser", "github.com")).toEqual([]);
    expect(ghLoginsIn("not json", "github.com")).toBeNull();
  });
});

describe("glabTokenIn", () => {
  it("reads the token from the status line of current and older versions", () => {
    expect(glabTokenIn("✓ Token found in config file (/home/me/.config/glab-cli/config.yml): glpat-xyz\n")).toBe("glpat-xyz");
    expect(glabTokenIn("✓ Token: glpat-old\n")).toBe("glpat-old");
  });

  it("takes none from text without a token line", () => {
    expect(glabTokenIn("")).toBeNull();
    expect(glabTokenIn("Token expired\n")).toBeNull();
  });
});

describe("execCli", () => {
  const withFakeCli = async (name: "gh" | "glab", script: string, run: () => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "fake-cli-"));
    const saved = { PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, GITLAB_TOKEN: process.env.GITLAB_TOKEN };
    try {
      await writeFile(join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      process.env.PATH = `${dir}:${saved.PATH}`;
      process.env.GH_TOKEN = "from-env";
      process.env.GITLAB_TOKEN = "from-env";
      await run();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("runs the program without a shell and without the token variables, and returns its stdout", async () => {
    await withFakeCli("gh", 'echo "[${GH_TOKEN-unset}] $*"', async () => {
      expect(await execCli("gh", ["auth", "token", "--hostname", "a b;c"])).toBe("[unset] auth token --hostname a b;c\n");
    });
  });

  it("returns glab's stderr after its stdout, since glab may report there", async () => {
    await withFakeCli("glab", 'echo "out"; echo "Token found in keyring: glpat-1" >&2', async () => {
      expect(glabTokenIn(await execCli("glab", ["auth", "status"]))).toBe("glpat-1");
    });
  });

  it("rejects without the program's stderr when it fails", async () => {
    await withFakeCli("gh", 'echo "gho_leaked" >&2; exit 1', async () => {
      await expect(execCli("gh", ["auth", "token"])).rejects.toThrow(/^gh failed$/);
    });
  });
});
