// The plugin's own git on the server: which credential helpers it may ask.
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGit } from "./git.js";
import { asEngineer, byEngineer, inBackground } from "./interaction.js";

function recorder() {
  const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const run = async (command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ command, args, env: options.env });
    return { exitCode: 0, stdout: "0123456789012345678901234567890123456789\tHEAD\n", stderr: "", timedOut: false, notFound: false };
  };
  return { calls, run };
}

const dataDir = () => join(tmpdir(), `onboarding-git-test-${process.pid}`);
const env = { PATH: process.env.PATH ?? "", GIT_ASKPASS: "/usr/bin/askpass", SSH_ASKPASS: "/usr/bin/askpass", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.x.insteadOf", GIT_CONFIG_VALUE_0: "y" };

describe("server-side git", () => {
  it("asks only gh's helper unless the engineer started the work", async () => {
    const { calls, run } = recorder();
    const git = createGit({ run, env, dataDir });
    await git.lsRemote("file:///srv/repos/team.git", null);
    const scheduled = calls[0]!;
    const helpers = scheduled.args.flatMap((arg, i) => (scheduled.args[i - 1] === "-c" && arg.startsWith("credential.helper=") ? [arg] : []));
    expect(helpers[0]).toBe("credential.helper=");
    for (const helper of helpers.slice(1)) expect(helper).toMatch(/^credential\.helper=!'.*\/gh' auth git-credential$/);
    expect(scheduled.args).toContain("core.askPass=");
    expect(scheduled.env.GIT_ASKPASS).toBeUndefined();
    expect(scheduled.env.SSH_ASKPASS).toBeUndefined();
    expect(scheduled.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(scheduled.env.GIT_SSH_COMMAND).toBe("ssh -F /dev/null -o BatchMode=yes -o IdentityAgent=none -o ConnectTimeout=10");
    expect(scheduled.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(scheduled.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(scheduled.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(scheduled.args).toEqual(expect.arrayContaining(["core.fsmonitor=false", "core.hooksPath=/dev/null"]));
    await asEngineer(() => git.lsRemote("file:///srv/repos/team.git", null));
    const clicked = calls[1]!;
    expect(clicked.args.some((arg) => arg.startsWith("credential.helper") || arg.startsWith("url."))).toBe(false);
    expect(clicked.args).toContain("core.askPass=");
    expect(clicked.env.GIT_SSH_COMMAND).not.toContain("IdentityAgent");
    expect(clicked.env.GIT_CONFIG_GLOBAL).toBeUndefined();
  });

  // Background fetches of a GitHub ssh source go over HTTPS through gh's helper.
  it("rewrites GitHub ssh URLs to HTTPS in the background, and only GitHub's", async () => {
    const { calls, run } = recorder();
    await createGit({ run, env, dataDir }).lsRemote("file:///srv/repos/team.git", null);
    const rewrite = calls[0]!.args.flatMap((arg, i) => (calls[0]!.args[i - 1] === "-c" && arg.startsWith("url.") ? ["-c", arg] : []));
    const resolved = (url: string) =>
      execFileSync("git", [...rewrite, "ls-remote", "--get-url", url], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
    expect(resolved("git@github.com:example-org/skills.git")).toBe("https://github.com/example-org/skills.git");
    expect(resolved("ssh://git@github.com/example-org/skills.git")).toBe("https://github.com/example-org/skills.git");
    expect(resolved("git@gitlab.example.com:team/skills.git")).toBe("git@gitlab.example.com:team/skills.git");
  });

  it("keeps background work started by a click in the background", async () => {
    expect(byEngineer()).toBe(false);
    await asEngineer(async () => {
      expect(byEngineer()).toBe(true);
      expect(inBackground(() => byEngineer())).toBe(false);
      const later = await new Promise<boolean>((resolve) => inBackground(() => setTimeout(() => resolve(byEngineer()), 1)));
      expect(later).toBe(false);
    });
  });
});
