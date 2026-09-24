// Turns raw git, gh and ssh output into categories.
//
// Raw output holds repository URLs, organisation names and SSO links, so it
// never leaves server memory. Results store only the category and facts the
// classifiers pick out (a login, scopes), and details are written from the
// category, not copied from the output.

export type AccessCategory =
  | "ok"
  | "no-auth"
  | "no-access"
  | "sso-required"
  | "network"
  | "host-key"
  | "ref-missing"
  | "blocked"
  | "error";

export const CATEGORY_TEXT: Record<string, string> = {
  ok: "Works.",
  "no-auth": "No working credentials for GitHub.",
  "no-access":
    "GitHub says the repository doesn't exist. It says the same when you can't read it, so ask for access.",
  "sso-required": "Your organisation requires single sign-on. Authorise your login for it on GitHub.",
  network: "Couldn't reach GitHub from this machine.",
  "host-key": "GitHub's host key didn't match the pinned keys.",
  "ref-missing": "The pinned version can't be fetched. Installed skills stay as they are.",
  blocked: "That host is this machine or a private network address, which the plugin doesn't fetch from.",
  "missing-scope": "The GitHub login is missing a permission your team needs.",
  "env-token": "A GH_TOKEN variable overrides the login on this machine.",
  expired: "The GitHub login expired or was revoked.",
  "not-installed": "Not installed.",
  "not-logged-in": "Not logged in.",
  "read-only": "Managed outside bb: the file is read-only.",
  error: "The check couldn't run.",
};

export interface GhAuthStatus {
  state: "logged-in" | "logged-out" | "error";
  category: "ok" | "not-logged-in" | "expired" | "missing-scope" | "env-token";
  login: string | null;
  scopes: string[];
  missingScopes: string[];
  tokenSource: string | null;
  /** With `state: "error"`: GitHub refused the token, or wasn't reached. */
  errorKind: "rejected" | "unreachable" | null;
}

/**
 * Parses `gh auth status --json hosts` (which always exits 0). Scopes a
 * broader scope covers count as present: `admin:public_key` covers
 * `write:public_key` and `read:public_key`.
 */
export function classifyGhAuthStatus(
  stdout: string,
  host: string,
  requiredScopes: readonly string[],
): GhAuthStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return blankAuth("error", "not-logged-in");
  }
  const hosts = (parsed as { hosts?: Record<string, unknown> }).hosts ?? {};
  const entries = Array.isArray(hosts[host]) ? (hosts[host] as Record<string, unknown>[]) : [];
  const active = entries.find((entry) => entry.active === true) ?? entries[0];
  if (active === undefined) return blankAuth("logged-out", "not-logged-in");
  const tokenSource = typeof active.tokenSource === "string" ? active.tokenSource : null;
  const login = typeof active.login === "string" && GITHUB_LOGIN.test(active.login) ? active.login : null;
  const scopes =
    typeof active.scopes === "string"
      ? active.scopes.split(",").map((scope) => scope.trim().replace(/^'|'$/g, "")).filter(Boolean)
      : Array.isArray(active.scopes)
        ? active.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
  if (active.state !== "success") {
    // gh reports both a refused token and a network failure as `error`;
    // its message tells them apart.
    const message = typeof active.error === "string" ? active.error : "";
    return {
      state: "error",
      category: isEnvToken(tokenSource) ? "env-token" : "expired",
      login,
      scopes,
      missingScopes: [],
      tokenSource,
      errorKind: message === "" || /\b40[13]\b|bad credentials/i.test(message) ? "rejected" : "unreachable",
    };
  }
  const missingScopes = requiredScopes.filter((scope) => !hasScope(scopes, scope));
  return {
    state: "logged-in",
    category: missingScopes.length > 0 ? "missing-scope" : "ok",
    login,
    scopes,
    missingScopes,
    tokenSource,
    errorKind: null,
  };
}

function blankAuth(state: GhAuthStatus["state"], category: GhAuthStatus["category"]): GhAuthStatus {
  return { state, category, login: null, scopes: [], missingScopes: [], tokenSource: null, errorKind: null };
}

/** `@login` for a detail line, or a plain phrase when gh named no valid login. */
export function atLogin(login: string | null): string {
  return login === null ? "an account gh didn't name" : `@${login}`;
}

/** A GitHub login as gh reports it; managed (EMU) logins carry an underscore. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62})$/;

/**
 * Whether bb's built-in git can share this login. bb 0.43.4 validates the
 * login it reads from `gh api user` against `^[a-zA-Z0-9-]+$`, so a managed
 * (EMU) login such as `name_short` makes it share nothing.
 */
export function isShareableLogin(login: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(login);
}

/**
 * Why gh exited non-zero after a device login, as a category. Only the
 * category leaves the machine; the output stays under Show details.
 */
export type LoginNote = "config-not-saved" | "gh-exit";

export function classifyLoginNote(stderr: string): LoginNote {
  return /failed to write config|read-only file system|permission denied/i.test(stderr) ? "config-not-saved" : "gh-exit";
}

export const LOGIN_NOTE_TEXT: Record<LoginNote, string> = {
  "config-not-saved": "gh couldn't save its settings file (config.yml is read-only here); your login is saved.",
  "gh-exit": "gh reported an error after the login; your login is saved.",
};

export function isEnvToken(tokenSource: string | null): boolean {
  return tokenSource === "GH_TOKEN" || tokenSource === "GITHUB_TOKEN" || tokenSource === "GH_ENTERPRISE_TOKEN";
}

/** Whether a granted scope list covers `wanted`, counting admin/write supersets. */
export function hasScope(granted: readonly string[], wanted: string): boolean {
  if (granted.includes(wanted)) return true;
  const [level, resource] = wanted.split(":");
  if (resource === undefined) {
    // `repo` covers `repo:status` etc., not the other way round.
    return false;
  }
  if (level === "read") {
    return granted.includes(`write:${resource}`) || granted.includes(`admin:${resource}`);
  }
  if (level === "write") return granted.includes(`admin:${resource}`);
  if (wanted.startsWith("repo:") || wanted === "public_repo") return granted.includes("repo");
  return false;
}

/** `gh api -i --silent repos/<owner>/<repo>`: status line and headers on stdout. */
export function classifyGhApi(exitCode: number, stdout: string, stderr: string): AccessCategory {
  const status = /^HTTP\/[\d.]+ (\d{3})/m.exec(stdout)?.[1];
  if (/^x-github-sso:\s*required/im.test(stdout)) return "sso-required";
  if (status === "200" && exitCode === 0) return "ok";
  if (exitCode === 4 || status === "401") return "no-auth";
  if (status === "404") return "no-access";
  if (status === "403") return /saml|sso/i.test(stderr) ? "sso-required" : "no-access";
  if (status === undefined && isNetworkError(stderr)) return "network";
  return exitCode === 0 ? "ok" : "error";
}

/** `git ls-remote` with `GIT_TERMINAL_PROMPT=0` and `BatchMode=yes`. */
export function classifyLsRemote(exitCode: number, stderr: string): AccessCategory {
  if (exitCode === 0) return "ok";
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) {
    return "host-key";
  }
  if (/permission denied \(publickey\)|could not read username|authentication failed|invalid username or token/i.test(stderr)) {
    return "no-auth";
  }
  if (/repository .* not found|repository not found/i.test(stderr)) return "no-access";
  if (/returned error: 403/i.test(stderr)) return "sso-required";
  if (isNetworkError(stderr)) return "network";
  return "error";
}

function isNetworkError(text: string): boolean {
  return /could not resolve|connection timed out|connection refused|network is unreachable|operation timed out|unable to access|couldn't connect|no route to host/i.test(
    text,
  );
}

export interface SshTestResult {
  category: AccessCategory;
  login: string | null;
}

/**
 * `ssh -T git@github.com`: GitHub answers `Hi <login>!` and exits 1. The
 * line is matched on stdout and stderr, since the docs don't say which.
 */
export function classifySshTest(exitCode: number, stdout: string, stderr: string): SshTestResult {
  const hi = /Hi ([A-Za-z0-9-]+)! You've successfully authenticated/.exec(`${stdout}\n${stderr}`);
  if (hi !== null) return { category: "ok", login: hi[1] ?? null };
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) {
    return { category: "host-key", login: null };
  }
  if (/permission denied \(publickey\)/i.test(stderr)) return { category: "no-auth", login: null };
  if (exitCode === 255 && isNetworkError(stderr)) return { category: "network", login: null };
  return { category: "error", login: null };
}

export interface DeviceCode {
  code: string;
  url: string;
}

/** Picks the one-time code and URL out of `gh auth login --web` stderr. */
export function parseDeviceCode(stderr: string): DeviceCode | null {
  const code = /one-time code(?: \()?: ?([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(stderr)?.[1]
    ?? /One-time code \(([A-Z0-9]{4}-[A-Z0-9]{4})\)/.exec(stderr)?.[1];
  if (code === undefined) return null;
  const url =
    /continue in your web browser: (https:\/\/\S+)/.exec(stderr)?.[1] ??
    "https://github.com/login/device";
  // Only GitHub's device page is ever shown; anything else is ignored.
  return { code, url: /^https:\/\/[a-z0-9.-]+\/login\/device$/.test(url) ? url : "https://github.com/login/device" };
}

/**
 * Masks secrets in text that leaves the server: "Show details" output, error
 * messages and anything else that came from a child process. Results never
 * hold raw output at all; this covers what is shown on request.
 */
/** Key or flag names that hold a secret: token, secret, password, api key, … */
const SECRET_WORD = "(?:auth[-_]?token|access[-_]?token|token|secret|password|passwd|pass|api[-_]?key|apikey|private[-_]?key|access[-_]?key|client[-_]?secret)";

export function redactSecrets(text: string): string {
  // Mask a little past the limit, then cut: a token straddling the cut is
  // masked whole instead of showing its first characters.
  return text
    .slice(0, 16_400)
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[private key]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, "$1[credentials]@")
    .replace(/\b(authorization|proxy-authorization)\s*:\s*\S+(\s+\S+)?/gi, "$1: [redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk_(live|test)_[A-Za-z0-9]{16,}|xapp-[A-Za-z0-9-]{20,}|hf_[A-Za-z0-9]{20,})(?![A-Za-z0-9])/g, "[token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[token]")
    .replace(/[^\s:/@]{1,200}:x-oauth-basic\b/gi, "[token]:x-oauth-basic")
    // npm's own `//registry/:_authToken=…` line.
    .replace(/(_auth(?:Token)?\s*=\s*)[^\s"'{},;]+/gi, "$1[redacted]")
    // Flags: --token=…, --password …, --api-key …
    .replace(new RegExp(`(--?[a-z0-9_-]{0,40}?${SECRET_WORD}[a-z0-9_-]{0,40})(=|\\s+)("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\\S+)`, "gi"), "$1$2[redacted]")
    // Assignments and JSON/YAML pairs whose key names a secret: KEY=…, key: …, "key": "…"
    .replace(
      new RegExp(`(["']?)\\b([a-z0-9_-]{0,40}?${SECRET_WORD}[a-z0-9_-]{0,40})\\1(\\s*[=:]\\s*)("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,;{}&"']+)`, "gi"),
      (match: string, quote: string, key: string, separator: string, value: string) =>
        // "secrets: a symlink…" is prose, not a pair: a bare lowercase word
        // before a colon counts only when quoted, upper-case or joined (db_password).
        separator.includes(":") && quote === "" && /^[a-z]+$/.test(key)
          ? match
          : `${quote}${key}${quote}${separator}${value.startsWith('"') ? '"[redacted]"' : value.startsWith("'") ? "'[redacted]'" : "[redacted]"}`,
    )
    .slice(0, 16_000);
}
