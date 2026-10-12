// The operator's `gh` and `glab` logins, run as processes: which logins each
// holds for a host, and the token each gives. Neither is asked for a login the
// operator did not choose, and neither answers from an environment variable.
import { execFile } from "node:child_process";
import { CredentialUnavailable, type CliLogins } from "../application/ports";

/** Runs `gh` or `glab` and returns what it printed. Rejects when it fails. */
export type RunCli = (command: "gh" | "glab", args: string[]) => Promise<string>;

const CLI_TIMEOUT_MS = 10_000;

/** Environment variables `gh` and `glab` answer from before their own login, which would stand in for the login the operator chose. */
const TOKEN_VARIABLES = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"];

/**
 * The real `RunCli`: no shell, a 10 second limit, and none of the token
 * variables in the environment. `glab`, and `gh auth status` before gh 2.81,
 * print what they report on stderr, so their answer is stdout followed by
 * stderr.
 */
export const execCli: RunCli = (command, args) => {
  const env = { ...process.env };
  for (const name of TOKEN_VARIABLES) delete env[name];
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: CLI_TIMEOUT_MS, env, maxBuffer: 64 * 1024, shell: false, windowsHide: true }, (error, stdout, stderr) => {
      // The error carries the command's stderr, which this layer does not pass on.
      if (error !== null) reject(new Error(`${command} failed`));
      else resolve(command === "glab" || args[1] === "status" ? `${stdout}\n${stderr}` : stdout);
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


/** The logins `gh auth status --json hosts` lists for a host; null for output that is no such answer. */
export const ghLoginsIn = (output: string, host: string): string[] | null => {
  try {
    const parsed = JSON.parse(output) as { hosts?: Record<string, { login?: unknown }[]> };
    const entries = parsed.hosts?.[host] ?? [];
    return entries.flatMap((entry) => (typeof entry.login === "string" && entry.login !== "" ? [entry.login] : []));
  } catch {
    return null;
  }
};

/** The logins an older `gh auth status`, or `glab auth status`, prints: `Logged in to <host> account <login>` or `as <login>`. */
export const loginsInText = (output: string, host: string): string[] => {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = [...plain.matchAll(new RegExp(`Logged in to ${escaped} (?:account|as) ([A-Za-z0-9_.-]+)`, "g"))].map((match) => match[1]!);
  return [...new Set(found)];
};

/** The operator's `gh` and `glab` logins, through `RunCli`. */
export class ExecCliLogins implements CliLogins {
  constructor(private readonly runCli: RunCli) {}

  async logins(tool: "gh" | "glab", host: string): Promise<string[]> {
    if (tool === "gh") {
      const json = await this.runCli("gh", ["auth", "status", "--hostname", host, "--json", "hosts"]).catch(() => null);
      const listed = json === null ? null : ghLoginsIn(json, host);
      if (listed !== null) return listed;
      // gh before 2.81 has no --json here, and prints its status on stderr; it fails when a login is not valid.
      const text = await this.runCli("gh", ["auth", "status", "--hostname", host]).catch(() => "");
      return loginsInText(text, host);
    }
    const text = await this.runCli("glab", ["auth", "status", "--hostname", host]).catch(() => "");
    return loginsInText(text, host);
  }

  async token(tool: "gh" | "glab", host: string, login: string): Promise<string> {
    const failure = () => new CredentialUnavailable(`${tool} gave no token for ${login} on ${host}`);
    let output: string;
    try {
      // glab holds one login a host, so it is asked for that one; the account checks whose it is.
      output = tool === "gh" ? await this.runCli("gh", ["auth", "token", "--hostname", host, "--user", login]) : await this.runCli("glab", ["auth", "status", "--hostname", host, "--show-token"]);
    } catch {
      throw failure();
    }
    const token = tool === "gh" ? output.trim() : glabTokenIn(output);
    if (token === null || token === "" || /\s/.test(token)) throw failure();
    return token;
  }
}
