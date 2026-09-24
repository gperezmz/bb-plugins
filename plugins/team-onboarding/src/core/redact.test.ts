import { describe, expect, it } from "vitest";
import {
  atLogin,
  classifyGhApi,
  classifyGhAuthStatus,
  classifyLoginNote,
  classifyLsRemote,
  classifySshTest,
  hasScope,
  isShareableLogin,
  parseDeviceCode,
  redactSecrets,
} from "./redact.js";

const loggedIn = (scopes: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hosts: {
      "github.com": [{ state: "success", active: true, host: "github.com", login: "octo", tokenSource: "/home/x/.config/gh/hosts.yml", scopes, gitProtocol: "https", ...extra }],
    },
  });

describe("gh auth status --json hosts", () => {
  it("reads login and scopes", () => {
    const status = classifyGhAuthStatus(loggedIn("gist, read:org, repo"), "github.com", ["repo"]);
    expect(status).toMatchObject({ state: "logged-in", category: "ok", login: "octo", missingScopes: [] });
  });

  // Acceptance 18: a missing scope is named.
  it("names a missing scope", () => {
    const status = classifyGhAuthStatus(loggedIn("gist, read:org, repo"), "github.com", ["repo", "workflow"]);
    expect(status).toMatchObject({ category: "missing-scope", missingScopes: ["workflow"] });
  });

  it("counts admin and write scopes as covering read and write", () => {
    expect(hasScope(["admin:public_key"], "write:public_key")).toBe(true);
    expect(hasScope(["admin:public_key"], "read:public_key")).toBe(true);
    expect(hasScope(["write:public_key"], "read:public_key")).toBe(true);
    expect(hasScope(["read:public_key"], "write:public_key")).toBe(false);
    expect(hasScope(["repo"], "repo:status")).toBe(true);
  });

  it("treats an empty host list as logged out (gh exits 0 either way)", () => {
    expect(classifyGhAuthStatus('{"hosts":{}}', "github.com", []).category).toBe("not-logged-in");
  });

  it("marks a revoked token as expired and a GH_TOKEN one as env-token", () => {
    const revoked = JSON.stringify({ hosts: { "github.com": [{ state: "error", active: true, login: "octo", tokenSource: "/x/hosts.yml" }] } });
    expect(classifyGhAuthStatus(revoked, "github.com", []).category).toBe("expired");
    const env = JSON.stringify({ hosts: { "github.com": [{ state: "error", active: true, login: "", tokenSource: "GH_TOKEN" }] } });
    expect(classifyGhAuthStatus(env, "github.com", []).category).toBe("env-token");
  });
});

describe("gh api -i --silent repos/<o>/<r>", () => {
  it("classifies the status line and headers", () => {
    expect(classifyGhApi(0, "HTTP/2.0 200 OK\nContent-Type: x\n", "")).toBe("ok");
    // Acceptance 20: no access and no such repo look the same.
    expect(classifyGhApi(1, "HTTP/2.0 404 Not Found\n", "gh: Not Found (HTTP 404)")).toBe("no-access");
    expect(classifyGhApi(1, "HTTP/2.0 403 Forbidden\nX-Github-Sso: required; url=https://github.com/orgs/x/sso?y\n", "")).toBe("sso-required");
    expect(classifyGhApi(1, "HTTP/2.0 401 Unauthorized\n", "gh: Bad credentials (HTTP 401)")).toBe("no-auth");
    expect(classifyGhApi(4, "", "To get started with GitHub CLI, please run:  gh auth login")).toBe("no-auth");
    expect(classifyGhApi(1, "", "dial tcp: lookup api.github.com: Could not resolve host")).toBe("network");
  });
});

describe("git ls-remote", () => {
  it("classifies git's stderr", () => {
    expect(classifyLsRemote(0, "")).toBe("ok");
    expect(classifyLsRemote(128, "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")).toBe("no-auth");
    expect(classifyLsRemote(128, "fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe("no-auth");
    expect(classifyLsRemote(128, "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found")).toBe("no-access");
    expect(classifyLsRemote(128, "Host key verification failed.")).toBe("host-key");
    expect(classifyLsRemote(128, "ssh: Could not resolve hostname github.com: Name or service not known")).toBe("network");
  });
});

describe("ssh -T git@github.com", () => {
  // Hypothesis 3: success exits 1 and says Hi <login>!, on stdout or stderr.
  it("finds the login on either stream", () => {
    const hi = "Hi octo! You've successfully authenticated, but GitHub does not provide shell access.";
    expect(classifySshTest(1, "", hi)).toEqual({ category: "ok", login: "octo" });
    expect(classifySshTest(1, hi, "")).toEqual({ category: "ok", login: "octo" });
  });

  it("classifies failures", () => {
    expect(classifySshTest(255, "", "git@github.com: Permission denied (publickey).").category).toBe("no-auth");
    expect(classifySshTest(255, "", "Host key verification failed.").category).toBe("host-key");
    expect(classifySshTest(255, "", "ssh: connect to host github.com port 22: Connection timed out").category).toBe("network");
  });
});

describe("device code", () => {
  // Hypothesis 4: gh 2.101.0's stderr format.
  it("parses gh's one-time code and URL", () => {
    const stderr = "\n! First copy your one-time code: 9424-DC61\nOpen this URL to continue in your web browser: https://github.com/login/device\n";
    expect(parseDeviceCode(stderr)).toEqual({ code: "9424-DC61", url: "https://github.com/login/device" });
  });

  it("parses the clipboard variant and ignores foreign URLs", () => {
    expect(parseDeviceCode("! One-time code (ABCD-1234) copied to clipboard\n")?.code).toBe("ABCD-1234");
    const odd = parseDeviceCode("! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://evil.example/phish\n");
    expect(odd?.url).toBe("https://github.com/login/device");
  });

  it("returns null before the code arrives", () => {
    expect(parseDeviceCode("! First copy your one-time")).toBeNull();
  });
});

/** Joins a token-shaped fixture at runtime, so secret scanners don't flag a fake. */
const fake = (...parts: string[]): string => parts.join("");

describe("redactSecrets", () => {
  it.each([
    [`token ${fake("gh", "p_abcdefghijklmnopqrstuvwxyz0123456789")} end`, "token [token] end"],
    [fake("gh", "o_abcdefghijklmnopqrstuvwxyz0123456789"), "[token]"],
    [fake("github_", "pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz"), "[token]"],
    [fake("gl", "pat-abcdefghijklmnopqrstu"), "[token]"],
    [fake("sk-", "ant-api03-abcdefghijklmnopqrstuvwxyz"), "[token]"],
    [fake("sk-", "proj-abcdefghijklmnopqrstuvwxyz"), "[token]"],
    ["fatal: https://user:s3cret@git.example.com/o/r.git", "fatal: https://[credentials]@git.example.com/o/r.git"],
    ["Request cannot be constructed from a URL that includes credentials: https://u:tok@example.com/x", "Request cannot be constructed from a URL that includes credentials: https://[credentials]@example.com/x"],
    ["Authorization: Bearer abcdefghijklmnop", "Authorization: [redacted]"],
    ["curl -H 'bearer abcdefghijklmnop'", "curl -H 'Bearer [redacted]'"],
    ["GH_TOKEN=abc123 TRACKER_API_KEY: xyz", "GH_TOKEN=[redacted] TRACKER_API_KEY: [redacted]"],
    ['{"NPM_TOKEN":"abc","other":1}', '{"NPM_TOKEN":"[redacted]","other":1}'],
    [`npm config set //registry.npmjs.org/:_auth${fake("To", "ken=00000000-1111-2222-3333-444444444444")}`, "npm config set //registry.npmjs.org/:_authToken=[redacted]"],
    ["mytool --token=s3cr3tvalue123 --password hunter2", "mytool --token=[redacted] --password [redacted]"],
    [`curl -d '{"token": "abc123def"}'`, `curl -d '{"token": "[redacted]"}'`],
    ["api-key=zzz999 client_secret: shh", "api-key=[redacted] client_secret: [redacted]"],
    ["PGPASSWORD=hunter2 psql", "PGPASSWORD=[redacted] psql"],
    ["PASS=hunter2 ./run", "PASS=[redacted] ./run"],
    ['x/:_authToken=npmPLAIN/{"token": "jsonSECRET"}/y', 'x/:_authToken=[redacted]{"token": "[redacted]"}/y'],
    ["//registry.npmjs.org/:_auth=dXNlcjpwYXNz", "//registry.npmjs.org/:_auth=[redacted]"],
    [fake("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"), "[token]"],
    [fake("sk_", "live_abcdefghijklmnop1234"), "[token]"],
    [fake("xa", "pp-1-A0123-4567890123-abcdef"), "[token]"],
    [fake("hf", "_abcdefghijklmnopqrstuvwx"), "[token]"],
    [fake("gh", "p_abcdefghijklmnopqrstuvwxyz0123456789_tail"), "[token]_tail"],
    [`key ${fake("AI", "zaSyA1234567890abcdefghijklmnopqrstuv")}`, "key [token]"],
    ["token1234abcd:x-oauth-basic", "[token]:x-oauth-basic"],
    [String.raw`{"token": "ab\"cd tail"}`, `{"token": "[redacted]"}`],
    ["gh_token=abc123 db_password: hunter2", "gh_token=[redacted] db_password: [redacted]"],
    ["npm_abcdefghijklmnopqrstuvwxyz0123", "[token]"],
    ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----", "[private key]"],
  ])("masks %s", (input, output) => {
    expect(redactSecrets(input)).toBe(output);
  });

  it("masks a token that straddles the length limit", () => {
    const out = redactSecrets(`${"x".repeat(15_990)} ${fake("gh", "p_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")}`);
    expect(out).not.toContain("ghp_");
    expect(out.length).toBeLessThanOrEqual(16_000);
  });

  // CPU time, not wall-clock time, so a busy machine doesn't fail it: the
  // regression it guards against (catastrophic backtracking) costs seconds of
  // CPU on these inputs, and linear matching costs milliseconds.
  it("stays fast on long input", () => {
    const started = process.cpuUsage();
    for (const text of ["a".repeat(20_000) + "!", "a-".repeat(10_000), "--" + "x_".repeat(8_000), '"'.repeat(15_000)]) redactSecrets(text);
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(1000);
  });

  it("leaves ordinary output alone", () => {
    expect(redactSecrets("deploy/secrets: a symlink that points outside")).toBe("deploy/secrets: a symlink that points outside");
    expect(redactSecrets("git version 2.55.0\nHTTP/2.0 404 Not Found")).toBe("git version 2.55.0\nHTTP/2.0 404 Not Found");
  });
});

describe("logins on real setups", () => {
  it("keeps managed (EMU) logins, which bb's built-in git can't share", () => {
    const emu = JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, login: "name_short", tokenSource: "GH_TOKEN", scopes: "repo" }] } });
    expect(classifyGhAuthStatus(emu, "github.com", []).login).toBe("name_short");
    expect(isShareableLogin("name_short")).toBe(false);
    expect(isShareableLogin("octo-cat")).toBe(true);
    const odd = JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, login: "<img src=x>", tokenSource: "x" }] } });
    expect(classifyGhAuthStatus(odd, "github.com", []).login).toBeNull();
  });

  it("names why gh exited non-zero after saving a login", () => {
    expect(classifyLoginNote("failed to write config to disk: open /h/.config/gh/config.yml: read-only file system")).toBe("config-not-saved");
    expect(classifyLoginNote("something else")).toBe("gh-exit");
  });
});

describe("gh errors and missing logins", () => {
  const withError = (error: string) =>
    JSON.stringify({ hosts: { "github.com": [{ state: "error", error, active: true, login: "", tokenSource: "GH_TOKEN" }] } });

  it("tells a refused token from an unreachable GitHub", () => {
    expect(classifyGhAuthStatus(withError('non-200 OK status code: 401 Unauthorized body: "Bad credentials"'), "github.com", []).errorKind).toBe("rejected");
    expect(classifyGhAuthStatus(withError('Post "https://api.github.com/graphql": dial tcp: connect: connection refused'), "github.com", []).errorKind).toBe("unreachable");
  });

  it("never writes @null", () => {
    expect(atLogin(null)).toBe("an account gh didn't name");
    expect(atLogin("octo")).toBe("@octo");
  });
});
