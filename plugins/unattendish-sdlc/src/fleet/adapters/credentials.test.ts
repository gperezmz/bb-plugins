import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedCredential } from "../application/ports";
import { parseRepo, parseTracker } from "../domain/identity";
import type { RepoRef, TrackerSpec } from "../domain/model";
import { CLI_TOKEN_TTL_MS, execCli, glabTokenIn, SettingsCredentials, type RunCli, type SettingValues } from "./credentials";

const repo = (text: string): RepoRef => parseRepo(text)!;
const tracker = (text: string): TrackerSpec => parseTracker(text)!;
const list = (...entries: object[]) => JSON.stringify(entries);

/** A clock tests move. */
const clockAt = (start = "2026-10-12T09:00:00Z") => {
  let now = new Date(start).getTime();
  return { now: () => new Date(now), advance: (ms: number) => (now += ms) };
};

const setup = (values: SettingValues, runCli: RunCli = async () => Promise.reject(new Error("no CLI expected"))) => {
  const clock = clockAt();
  const calls: [string, string[]][] = [];
  const cli: RunCli = (command, args) => {
    calls.push([command, args]);
    return runCli(command, args);
  };
  return { credentials: new SettingsCredentials(() => values, cli, clock), clock, calls };
};

const found = (lookup: ReturnType<SettingsCredentials["forForge"]>): ResolvedCredential => {
  if (!lookup.found) throw new Error(`no credential for ${lookup.prefix}`);
  return lookup.credential;
};

describe("forForge", () => {
  it("uses the longest prefix matching the repository", () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com", auth: "token" }, { prefix: "github.com/org", auth: "token" }, { prefix: "github.com/org/repo", auth: "gh" }), tokens: undefined });
    expect(found(credentials.forForge(repo("github.com/org/repo"))).prefix).toBe("github.com/org/repo");
    expect(found(credentials.forForge(repo("github.com/org/other"))).prefix).toBe("github.com/org");
    expect(found(credentials.forForge(repo("github.com/else/x"))).prefix).toBe("github.com");
  });

  it("matches whole host and whole path segments only", () => {
    const { credentials } = setup({ credentials: list({ prefix: "gitlab.com", auth: "token" }, { prefix: "github.com/org", auth: "token" }), tokens: undefined });
    expect(credentials.forForge(repo("gitlab.com.evil.net/x"))).toEqual({ found: false, prefix: "gitlab.com.evil.net/x" });
    expect(credentials.forForge(repo("github.com/organization/repo"))).toEqual({ found: false, prefix: "github.com/organization/repo" });
    expect(credentials.forForge(repo("xgithub.com/org/repo")).found).toBe(false);
  });

  it("finds nothing when no entry matches, naming the repository as the missing prefix", () => {
    const { credentials } = setup({ credentials: "[]", tokens: '{"github.com/org": "ghp_x"}' });
    expect(credentials.forForge(repo("github.com/org/repo"))).toEqual({ found: false, prefix: "github.com/org/repo" });
  });

  it("resolves the service, base URL and host by default for github.com, GitHub Enterprise and GitLab", () => {
    const { credentials } = setup({
      credentials: list({ prefix: "github.com", auth: "token" }, { prefix: "ghe.example.com", auth: "token", service: "github" }, { prefix: "gitlab.com", auth: "glab" }, { prefix: "git.example.com", auth: "token", service: "gitlab" }),
      tokens: undefined,
    });
    expect(found(credentials.forForge(repo("github.com/o/r")))).toEqual({ prefix: "github.com", service: "github", auth: "token", baseUrl: "https://api.github.com", host: "api.github.com" });
    expect(found(credentials.forForge(repo("ghe.example.com/o/r")))).toMatchObject({ service: "github", baseUrl: "https://ghe.example.com/api/v3", host: "ghe.example.com" });
    expect(found(credentials.forForge(repo("gitlab.com/g/s/p")))).toMatchObject({ service: "gitlab", auth: "glab", baseUrl: "https://gitlab.com/api/v4", host: "gitlab.com" });
    expect(found(credentials.forForge(repo("git.example.com/g/p")))).toMatchObject({ service: "gitlab", baseUrl: "https://git.example.com/api/v4" });
  });

  it("reports the prefix as written and keeps the entry's own base URL, even loopback over http", () => {
    const { credentials } = setup({ credentials: list({ prefix: "GitHub.com/Org", auth: "token", baseUrl: "http://127.0.0.1:4010" }), tokens: undefined });
    expect(found(credentials.forForge(repo("github.com/org/r")))).toMatchObject({ prefix: "GitHub.com/Org", baseUrl: "http://127.0.0.1:4010", host: "127.0.0.1" });
  });

  it("finds nothing for a host that names no service and an entry that does not either", () => {
    const { credentials } = setup({ credentials: list({ prefix: "git.example.com", auth: "token" }), tokens: undefined });
    expect(credentials.forForge(repo("git.example.com/g/p")).found).toBe(false);
  });

  it("does not fall back to a shorter prefix when the longest one was refused", () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com", auth: "token" }, { prefix: "github.com/org", auth: "token", baseUrl: "https://evil.example" }), tokens: undefined });
    expect(credentials.forForge(repo("github.com/org/r"))).toEqual({ found: false, prefix: "github.com/org/r" });
    expect(found(credentials.forForge(repo("github.com/else/r"))).prefix).toBe("github.com");
  });

  it("does not use a Linear or Jira entry for a repository", () => {
    const { credentials } = setup({ credentials: list({ prefix: "linear:", auth: "token" }, { prefix: "jira:github.com", auth: "token" }), tokens: undefined });
    expect(credentials.forForge(repo("github.com/o/r")).found).toBe(false);
  });
});

describe("forTracker", () => {
  const values: SettingValues = {
    credentials: list({ prefix: "github.com/org", auth: "token" }, { prefix: "linear:", auth: "token" }, { prefix: "linear:ENG", auth: "token" }, { prefix: "jira:a.atlassian.net", auth: "token" }, { prefix: "jira:a.atlassian.net/PROJ", auth: "token" }),
    tokens: undefined,
  };

  it("uses the forge's own credential for forge-issues", () => {
    const { credentials } = setup(values);
    expect(found(credentials.forTracker(tracker("forge-issues"), repo("github.com/org/repo"))).prefix).toBe("github.com/org");
  });

  it("looks a separate tracker up on its own, apart from the forge's", () => {
    const { credentials } = setup(values);
    const forge = repo("github.com/org/repo");
    expect(found(credentials.forTracker(tracker("linear:eng"), forge))).toMatchObject({ prefix: "linear:ENG", service: "linear", baseUrl: "https://api.linear.app/graphql", host: "api.linear.app" });
    expect(found(credentials.forTracker(tracker("linear:OPS"), forge)).prefix).toBe("linear:");
    expect(found(credentials.forTracker(tracker("jira:a.atlassian.net/PROJ"), forge))).toMatchObject({ prefix: "jira:a.atlassian.net/PROJ", service: "jira", baseUrl: "https://a.atlassian.net", host: "a.atlassian.net" });
    expect(found(credentials.forTracker(tracker("jira:a.atlassian.net/OTHER"), forge)).prefix).toBe("jira:a.atlassian.net");
  });

  it("finds nothing for a tracker no entry covers, naming it, even when the forge has a credential", () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/org", auth: "token" }), tokens: undefined });
    const forge = repo("github.com/org/repo");
    expect(credentials.forTracker(tracker("linear:ENG"), forge)).toEqual({ found: false, prefix: "linear:ENG" });
    expect(credentials.forTracker(tracker("jira:b.atlassian.net/X"), forge)).toEqual({ found: false, prefix: "jira:b.atlassian.net/X" });
  });

  it("does not use another Jira site's entry", () => {
    const { credentials } = setup(values);
    expect(credentials.forTracker(tracker("jira:b.atlassian.net/PROJ"), repo("github.com/org/repo")).found).toBe(false);
  });
});

describe("token for a pasted token", () => {
  it("returns the token pasted for exactly that prefix, whatever its spelling", async () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/org", auth: "token" }, { prefix: "github.com", auth: "token" }), tokens: '{"GitHub.com/ORG": "ghp_org", "github.com": "ghp_host"}' });
    expect(await credentials.token(found(credentials.forForge(repo("github.com/org/r"))))).toBe("ghp_org");
    expect(await credentials.token(found(credentials.forForge(repo("github.com/else/r"))))).toBe("ghp_host");
  });

  it("rejects when no token was pasted for the prefix, without borrowing another prefix's", async () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/org", auth: "token" }), tokens: '{"github.com": "ghp_host"}' });
    await expect(credentials.token(found(credentials.forForge(repo("github.com/org/r"))))).rejects.toThrow("No token is set for github.com/org");
  });

  it("rejects a credential the settings no longer hold", async () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/org", auth: "token" }), tokens: '{"github.com/org": "ghp_x"}' });
    const credential = found(credentials.forForge(repo("github.com/org/r")));
    credentials.reload({ credentials: "[]", tokens: '{"github.com/org": "ghp_x"}' });
    await expect(credentials.token(credential)).rejects.toThrow("No credential is configured");
    await expect(credentials.token({ ...credential, auth: "gh" })).rejects.toThrow();
  });

  it("uses the Jira token as pasted, email and all", async () => {
    const { credentials } = setup({ credentials: list({ prefix: "jira:a.atlassian.net", auth: "token" }), tokens: '{"jira:a.atlassian.net": "me@example.com:tok"}' });
    expect(await credentials.token(found(credentials.forTracker(tracker("jira:a.atlassian.net/P"), repo("github.com/o/r"))))).toBe("me@example.com:tok");
  });
});

describe("token from gh and glab", () => {
  const ghValues: SettingValues = { credentials: list({ prefix: "github.com/org", auth: "gh" }), tokens: undefined };

  it("asks gh for the host the prefix names, not the API host, and trims the answer", async () => {
    const { credentials, calls } = setup(ghValues, async () => "gho_abc\n");
    expect(await credentials.token(found(credentials.forForge(repo("github.com/org/r"))))).toBe("gho_abc");
    expect(calls).toEqual([["gh", ["auth", "token", "--hostname", "github.com"]]]);
  });

  it("asks glab to show the token for the host and reads it from the status text", async () => {
    const status = "gitlab.example.com\n  \u001b[32m✓\u001b[0m Logged in to gitlab.example.com as me\n  ✓ Token found in keyring: glpat-abc123\n";
    const { credentials, calls } = setup({ credentials: list({ prefix: "gitlab.example.com", auth: "glab", service: "gitlab" }), tokens: undefined }, async () => status);
    expect(await credentials.token(found(credentials.forForge(repo("gitlab.example.com/g/p"))))).toBe("glpat-abc123");
    expect(calls).toEqual([["glab", ["auth", "status", "--hostname", "gitlab.example.com", "--show-token"]]]);
  });

  it("keeps a CLI token for 5 minutes, then asks again", async () => {
    let n = 0;
    const { credentials, calls, clock } = setup(ghValues, async () => `gho_${++n}\n`);
    const credential = found(credentials.forForge(repo("github.com/org/r")));
    expect(await credentials.token(credential)).toBe("gho_1");
    clock.advance(CLI_TOKEN_TTL_MS - 1);
    expect(await credentials.token(credential)).toBe("gho_1");
    clock.advance(1);
    expect(await credentials.token(credential)).toBe("gho_2");
    expect(calls).toHaveLength(2);
  });

  it("asks again after the settings are reloaded", async () => {
    let n = 0;
    const { credentials, calls } = setup(ghValues, async () => `gho_${++n}`);
    const credential = found(credentials.forForge(repo("github.com/org/r")));
    await credentials.token(credential);
    credentials.reload(ghValues);
    await credentials.token(credential);
    expect(calls).toHaveLength(2);
  });

  it("rejects when the CLI fails or prints nothing, naming neither the output nor the error", async () => {
    const failing = setup(ghValues, async () => Promise.reject(new Error("stderr says gho_leaked")));
    const credential = found(failing.credentials.forForge(repo("github.com/org/r")));
    const error = await failing.credentials.token(credential).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("gh gave no token for github.com");
    const empty = setup(ghValues, async () => "  \n");
    await expect(empty.credentials.token(found(empty.credentials.forForge(repo("github.com/org/r"))))).rejects.toThrow("gave no token");
  });

  it("rejects glab output that has no token or a masked one", async () => {
    for (const status of ["✓ Logged in to gitlab.com as me\n", "✓ Token found in keyring: **************************\n"]) {
      const { credentials } = setup({ credentials: list({ prefix: "gitlab.com", auth: "glab" }), tokens: undefined }, async () => status);
      await expect(credentials.token(found(credentials.forForge(repo("gitlab.com/g/p"))))).rejects.toThrow("glab gave no token for gitlab.com");
    }
  });

  it("never runs a CLI for an entry whose auth is token, nor falls back to one", async () => {
    const { credentials, calls } = setup({ credentials: list({ prefix: "github.com/org", auth: "token" }), tokens: undefined }, async () => "gho_x");
    await expect(credentials.token(found(credentials.forForge(repo("github.com/org/r"))))).rejects.toThrow();
    expect(credentials.forForge(repo("github.com/else/r")).found).toBe(false);
    expect(calls).toEqual([]);
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

describe("secrets and the rate limit", () => {
  it("lists every pasted token and every token a CLI gave, even after its cache expired", async () => {
    const { credentials, clock } = setup({ credentials: list({ prefix: "github.com/a", auth: "token" }, { prefix: "github.com/b", auth: "gh" }), tokens: '{"github.com/a": "ghp_a"}' }, async () => "gho_b\n");
    expect(credentials.secrets()).toEqual(["ghp_a"]);
    await credentials.token(found(credentials.forForge(repo("github.com/b/r"))));
    clock.advance(CLI_TOKEN_TTL_MS * 2);
    expect(credentials.secrets().sort()).toEqual(["gho_b", "ghp_a"]);
  });

  it("says a gh or glab login shares the agents' rate limit and a pasted token does not", () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/a", auth: "token" }, { prefix: "github.com/b", auth: "gh" }, { prefix: "gitlab.com", auth: "glab" }), tokens: undefined });
    expect(credentials.usesAgentRateLimit(found(credentials.forForge(repo("github.com/a/r"))))).toBe(false);
    expect(credentials.usesAgentRateLimit(found(credentials.forForge(repo("github.com/b/r"))))).toBe(true);
    expect(credentials.usesAgentRateLimit(found(credentials.forForge(repo("gitlab.com/g/p"))))).toBe(true);
  });
});

describe("problems and reload", () => {
  it("lists what is wrong with either setting, with no token in it", () => {
    const { credentials } = setup({ credentials: list({ prefix: "github.com/a", auth: "token", baseUrl: "https://evil.example" }), tokens: '{"github.com/a": "two words ghp_leak"}' });
    const problems = credentials.problems();
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).not.toContain("ghp_leak");
  });

  it("applies new settings on reload", async () => {
    const { credentials } = setup({ credentials: "[]", tokens: undefined });
    expect(credentials.forForge(repo("github.com/o/r")).found).toBe(false);
    credentials.reload({ credentials: list({ prefix: "github.com", auth: "token" }), tokens: '{"github.com": "ghp_new"}' });
    expect(await credentials.token(found(credentials.forForge(repo("github.com/o/r"))))).toBe("ghp_new");
    expect(credentials.problems()).toEqual([]);
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
