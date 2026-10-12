// Credentials from the plugin's settings. A credential is used only when the
// operator chose it for a prefix that matches the fleet: there is no fallback
// to a shorter or other entry, to a `gh` or `glab` login that was not chosen,
// or to an environment variable.
import { execFile } from "node:child_process";
import type { Clock, CredentialLookup, Credentials, ResolvedCredential } from "../application/ports";
import { formatRepo, longestMatch, parsePrefix, repoSubject, trackerSubject, type Prefix, type Subject } from "../domain/identity";
import type { RepoRef, TrackerSpec } from "../domain/model";
import { parseCredentialEntries, parseTokens, prefixKey, type CredentialEntry } from "./settings";

/** The two settings' values as bb stores them; `tokens` is unset until a token is pasted. */
export interface SettingValues {
  readonly credentials: string;
  readonly tokens: string | undefined;
}

/** Runs `gh` or `glab` and returns what it printed. Rejects when it fails. */
export type RunCli = (command: "gh" | "glab", args: string[]) => Promise<string>;

/** How long a token obtained from `gh` or `glab` is kept before the CLI is asked again. */
export const CLI_TOKEN_TTL_MS = 5 * 60_000;
const CLI_TIMEOUT_MS = 10_000;

/** Environment variables `gh` and `glab` answer from before their own login, which would stand in for the login the operator chose. */
const TOKEN_VARIABLES = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"];

/**
 * The real `RunCli`: no shell, a 10 second limit, and none of the token
 * variables in the environment. `glab` prints what it reports on stderr in
 * some versions, so its answer is stdout followed by stderr.
 */
export const execCli: RunCli = (command, args) => {
  const env = { ...process.env };
  for (const name of TOKEN_VARIABLES) delete env[name];
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: CLI_TIMEOUT_MS, env, maxBuffer: 64 * 1024, shell: false, windowsHide: true }, (error, stdout, stderr) => {
      // The error carries the command's stderr, which this layer does not pass on.
      if (error !== null) reject(new Error(`${command} failed`));
      else resolve(command === "glab" ? `${stdout}\n${stderr}` : stdout);
    });
  });
};

/**
 * The token in what `glab auth status --show-token` printed: the text after
 * `Token found in <where it is kept>: ` (older versions: `Token: `). Null when
 * there is none or it is masked.
 */
export const glabTokenIn = (output: string): string | null => {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  let found: string | null = null;
  for (const match of plain.matchAll(/\bToken(?: found in .*)?: (\S+)[ \t]*$/gm)) found = match[1]!;
  return found === null || /^\*+$/.test(found) ? null : found;
};

const hostnameOf = (baseUrl: string): string => new URL(baseUrl).hostname.toLowerCase();

const subjectText = (subject: Subject): string => {
  switch (subject.kind) {
    case "repo":
      return [subject.host, ...subject.path].join("/");
    case "linear":
      return `linear:${subject.team}`;
    case "jira":
      return `jira:${subject.site}/${subject.project}`;
  }
};

interface Candidate {
  readonly prefix: Prefix;
  /** Null for an entry the settings refused: it still blocks a shorter prefix from standing in for it. */
  readonly entry: CredentialEntry | null;
}

/** Looks credentials up in the plugin's settings and obtains their tokens. */
export class SettingsCredentials implements Credentials {
  private entries: CredentialEntry[] = [];
  private candidates: Candidate[] = [];
  private tokens = new Map<string, string>();
  private settingProblems: string[] = [];
  private readonly cliTokens = new Map<string, { token: string; expiresAt: number }>();
  /** Every token a CLI has given, kept after its cache entry expires so text can still be scrubbed of it. */
  private readonly cliSeen = new Set<string>();

  constructor(
    read: () => SettingValues,
    private readonly runCli: RunCli,
    private readonly clock: Clock,
  ) {
    this.reload(read());
  }

  /** Reads the settings again, after either changed. Tokens obtained from a CLI are asked for again. */
  reload(values: SettingValues): void {
    const credentials = parseCredentialEntries(values.credentials);
    const tokens = parseTokens(values.tokens ?? "");
    this.entries = credentials.entries;
    this.candidates = [...credentials.entries.map((entry) => ({ prefix: entry.prefix, entry })), ...credentials.unusable.map((u) => ({ prefix: u.prefix, entry: null }))];
    this.tokens = tokens.tokens;
    this.settingProblems = [...credentials.problems, ...tokens.problems];
    this.cliTokens.clear();
  }

  /** What is wrong with the settings, for a person. Never carries a token. */
  problems(): string[] {
    return [...this.settingProblems];
  }

  forForge(repo: RepoRef): CredentialLookup {
    return this.lookup(repoSubject(repo), formatRepo(repo));
  }

  forTracker(tracker: TrackerSpec, repo: RepoRef): CredentialLookup {
    return this.lookup(trackerSubject(tracker, repo), subjectText(trackerSubject(tracker, repo)));
  }

  private lookup(subject: Subject, missing: string): CredentialLookup {
    const best = longestMatch(this.candidates, subject)?.entry ?? null;
    if (best === null) return { found: false, prefix: missing };
    return {
      found: true,
      credential: { prefix: best.text, service: best.service, auth: best.auth, baseUrl: best.baseUrl, host: hostnameOf(best.baseUrl) },
    };
  }

  async token(credential: ResolvedCredential): Promise<string> {
    const parsed = parsePrefix(credential.prefix);
    const entry = parsed === null ? undefined : this.entries.find((e) => prefixKey(e.prefix) === prefixKey(parsed) && e.auth === credential.auth);
    if (parsed === null || entry === undefined) throw new Error(`No credential is configured for ${credential.prefix}`);
    if (entry.auth === "token") {
      const token = this.tokens.get(prefixKey(parsed));
      if (token === undefined) throw new Error(`No token is set for ${credential.prefix}`);
      return token;
    }
    // A login is asked for the host the operator's prefix names, which is not the API host (`github.com`, not `api.github.com`).
    const hostname = parsed.kind === "repo" ? parsed.host : "";
    const key = `${entry.auth}:${hostname}`;
    const cached = this.cliTokens.get(key);
    if (cached !== undefined && cached.expiresAt > this.clock.now().getTime()) return cached.token;
    const token = await this.fromCli(entry.auth, hostname);
    this.cliTokens.set(key, { token, expiresAt: this.clock.now().getTime() + CLI_TOKEN_TTL_MS });
    this.cliSeen.add(token);
    return token;
  }

  private async fromCli(auth: "gh" | "glab", hostname: string): Promise<string> {
    const failure = () => new Error(`${auth} gave no token for ${hostname}`);
    let output: string;
    try {
      output = auth === "gh" ? await this.runCli("gh", ["auth", "token", "--hostname", hostname]) : await this.runCli("glab", ["auth", "status", "--hostname", hostname, "--show-token"]);
    } catch {
      throw failure();
    }
    const token = auth === "gh" ? output.trim() : glabTokenIn(output);
    if (token === null || token === "" || /\s/.test(token)) throw failure();
    return token;
  }

  secrets(): string[] {
    return [...new Set([...this.tokens.values(), ...this.cliSeen])];
  }

  /** Whether the fleet's agents act through the same login, and so share its rate limit. */
  usesAgentRateLimit(credential: ResolvedCredential): boolean {
    return credential.auth !== "token";
  }
}
