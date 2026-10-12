// The plugin's two settings, and what they say. `credentials` names, per
// prefix, how a Credential authenticates; `tokens` holds the pasted tokens
// and is the only place one is typed. Neither setting is parsed by a command
// that takes a token on its command line: there is none.
import { z } from "zod";
import type { ServiceKind } from "../domain/model";
import { defaultServiceOfHost, parsePrefix, prefixText, type Prefix } from "../domain/identity";

/** How a Credential authenticates: a pasted token, the `gh` login or the `glab` login. */
export type CredentialAuth = "token" | "gh" | "glab";

/** One entry of the `credentials` setting, checked and with its defaults filled in. */
export interface CredentialEntry {
  /** The prefix as written (trimmed). */
  readonly text: string;
  readonly prefix: Prefix;
  readonly auth: CredentialAuth;
  readonly service: ServiceKind;
  /** The REST root, or Linear's GraphQL endpoint, the token may be sent to. */
  readonly baseUrl: string;
}

/** What reading the `credentials` setting gave. */
export interface ParsedCredentials {
  /** The entries that can be used. */
  readonly entries: CredentialEntry[];
  /** One sentence per entry or part of the setting that cannot be used, for a person. Never carries a token. */
  readonly problems: string[];
  /** The prefixes of entries that were refused. A lookup that lands on one finds no credential, rather than falling back to a shorter prefix. */
  readonly unusable: { readonly text: string; readonly prefix: Prefix }[];
}

/** What reading the `tokens` setting gave. */
export interface ParsedTokens {
  /** The pasted tokens by `prefixKey`. */
  readonly tokens: Map<string, string>;
  /** One sentence per fault. Never carries a token. */
  readonly problems: string[];
}

/** The key two spellings of one prefix share: a host and path segments match without regard to case. */
export const prefixKey = (prefix: Prefix): string => prefixText(prefix).toLowerCase();

/** Every service, in one list the settings validator reads. */
const SERVICES = ["github", "gitlab", "linear", "jira"] as const satisfies readonly ServiceKind[];
/** Fails to compile when `ServiceKind` gains a service `SERVICES` lacks. */
const _everyService: Exclude<ServiceKind, (typeof SERVICES)[number]> extends never ? true : never = true;
void _everyService;

const ENTRY = z.strictObject({
  prefix: z.string().min(1),
  auth: z.enum(["token", "gh", "glab"]),
  service: z.enum(SERVICES).optional(),
  baseUrl: z.string().min(1).optional(),
});

/** A hostname the plugin lets a base URL use for testing without https. */
export const isLoopbackHost = (hostname: string): boolean => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

/**
 * The only hostnames a credential for this prefix may send its token to,
 * besides loopback. `api.<host>` is allowed for github.com alone, which is
 * where GitHub's REST API lives; any other host serves its API itself.
 */
const allowedHosts = (prefix: Prefix): string[] => {
  switch (prefix.kind) {
    case "repo":
      return prefix.host === "github.com" ? [prefix.host, "api.github.com"] : [prefix.host];
    case "linear":
      return ["api.linear.app"];
    case "jira":
      return [prefix.site];
  }
};

/** Why a base URL cannot be used for a prefix, or null when it can. */
export const baseUrlProblem = (prefix: Prefix, baseUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "baseUrl is not a URL";
  }
  if (url.username !== "" || url.password !== "") return "baseUrl may not carry a user name or password";
  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHost(hostname)) return url.protocol === "https:" || url.protocol === "http:" ? null : "baseUrl must be https";
  if (url.protocol !== "https:") return "baseUrl must be https (http is allowed only on loopback)";
  const hosts = allowedHosts(prefix);
  if (!hosts.includes(hostname)) return `baseUrl must be on ${hosts.join(" or ")}, the host of the prefix`;
  return null;
};

/** Why a service does not fit a prefix, or null when it does. */
const serviceProblem = (prefix: Prefix, service: ServiceKind | null): string | null => {
  switch (prefix.kind) {
    case "linear":
      return service === null || service === "linear" ? null : "a linear: prefix is for the linear service";
    case "jira":
      return service === null || service === "jira" ? null : "a jira: prefix is for the jira service";
    case "repo":
      if (service === "github" || service === "gitlab") return null;
      if (service === null) return defaultServiceOfHost(prefix.host) === null ? `needs "service": "github" or "gitlab", since ${prefix.host} does not name its service` : null;
      return "a repository prefix is for the github or gitlab service";
  }
};

/** The default REST root for a service and prefix. */
export const defaultBaseUrl = (prefix: Prefix, service: ServiceKind): string => {
  switch (service) {
    case "github":
      return prefix.kind === "repo" && prefix.host !== "github.com" ? `https://${prefix.host}/api/v3` : "https://api.github.com";
    case "gitlab":
      return `https://${(prefix as Extract<Prefix, { kind: "repo" }>).host}/api/v4`;
    case "linear":
      return "https://api.linear.app/graphql";
    case "jira":
      return `https://${(prefix as Extract<Prefix, { kind: "jira" }>).site}`;
  }
};

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    // The parser's own message quotes the text, which may hold a token.
    return { ok: false };
  }
};

/** Reads the `credentials` setting: a JSON list of entries. */
export function parseCredentialEntries(text: string): ParsedCredentials {
  const entries: CredentialEntry[] = [];
  const problems: string[] = [];
  const unusable: { text: string; prefix: Prefix }[] = [];
  if (text.trim() === "") return { entries, problems, unusable };
  const json = parseJson(text);
  if (!json.ok) return { entries, problems: ["credentials is not valid JSON"], unusable };
  if (!Array.isArray(json.value)) return { entries, problems: ["credentials must be a JSON list of entries"], unusable };
  const seen = new Set<string>();
  json.value.forEach((item: unknown, index) => {
    const label = `credentials entry ${index + 1}`;
    const shape = ENTRY.safeParse(item);
    if (!shape.success) {
      for (const issue of shape.error.issues) problems.push(`${label}: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`);
      return;
    }
    const { prefix: written, auth, service: chosen, baseUrl } = shape.data;
    const prefix = parsePrefix(written);
    if (prefix === null) {
      problems.push(`${label}: the prefix is not a host, an owner or group path, a repository path, linear:<team key> or jira:<site>[/<project key>]`);
      return;
    }
    const name = `credentials entry ${index + 1} (${written.trim()})`;
    const refuse = (reason: string) => {
      problems.push(`${name}: ${reason}`);
      unusable.push({ text: written.trim(), prefix });
    };
    const key = prefixKey(prefix);
    if (seen.has(key)) return refuse("the prefix is already given by an earlier entry");
    seen.add(key);
    const fault = serviceProblem(prefix, chosen ?? null);
    if (fault !== null) return refuse(fault);
    const service: ServiceKind = chosen ?? (prefix.kind === "linear" ? "linear" : prefix.kind === "jira" ? "jira" : defaultServiceOfHost(prefix.host)!);
    if (auth === "gh" && service !== "github") return refuse('"gh" is the GitHub login: use it for a github service');
    if (auth === "glab" && service !== "gitlab") return refuse('"glab" is the GitLab login: use it for a gitlab service');
    const root = baseUrl?.trim() ?? defaultBaseUrl(prefix, service);
    const bad = baseUrl === undefined ? null : baseUrlProblem(prefix, root);
    if (bad !== null) return refuse(bad);
    entries.push({ text: written.trim(), prefix, auth, service, baseUrl: root });
  });
  return { entries, problems, unusable };
}

/** Reads the `tokens` setting: a JSON object from prefix to pasted token. */
export function parseTokens(text: string): ParsedTokens {
  const tokens = new Map<string, string>();
  const problems: string[] = [];
  if (text.trim() === "") return { tokens, problems };
  const json = parseJson(text);
  if (!json.ok) return { tokens, problems: ["tokens is not valid JSON"] };
  if (typeof json.value !== "object" || json.value === null || Array.isArray(json.value)) return { tokens, problems: ["tokens must be a JSON object from prefix to token"] };
  for (const [written, value] of Object.entries(json.value)) {
    const prefix = parsePrefix(written);
    if (prefix === null) {
      problems.push("tokens: a key is not a valid prefix");
      continue;
    }
    const name = prefixKey(prefix);
    if (typeof value !== "string" || value.trim() === "") problems.push(`tokens: the token for ${name} must be a non-empty string`);
    else if (/\s/.test(value.trim())) problems.push(`tokens: the token for ${name} may not hold whitespace`);
    else if (tokens.has(name)) problems.push(`tokens: ${name} is given twice`);
    else tokens.set(name, value.trim());
  }
  return { tokens, problems };
}

const validator = (problemsOf: (text: string) => string[]) =>
  z.string().superRefine((text, context) => {
    for (const message of problemsOf(text)) context.addIssue({ code: "custom", message });
  });

/** `experimental_schema` for `credentials`: refuses what `parseCredentialEntries` reports. */
export const credentialsText = validator((text) => parseCredentialEntries(text).problems);
/** `experimental_schema` for `tokens`: refuses what `parseTokens` reports. */
export const tokensText = validator((text) => parseTokens(text).problems);

export const SETTINGS = {
  credentials: {
    type: "string",
    label: "Credentials",
    description:
      'JSON list saying how the plugin signs in to each service, e.g. [{"prefix": "github.com/org", "auth": "token"}, {"prefix": "gitlab.com", "auth": "glab"}, {"prefix": "linear:", "auth": "token"}]. "auth" is "token" (a token pasted under Tokens), "gh" (use my gh login) or "glab" (use my glab login); it is chosen for each prefix and never falls back to another. A prefix is a host (github.com), an owner or group path (github.com/org), a full repository path (github.com/org/repo), linear: (every Linear team) or linear:<team key>, jira:<site> (every project of a Jira Cloud site) or jira:<site>/<project key>. It matches whole host and whole path segments only, and a fleet uses the longest prefix that matches its repository, and separately its tracker. Optional "service" ("github", "gitlab", "linear" or "jira") is needed for a host other than github.com and gitlab.com. Optional "baseUrl" is the API root, on the prefix\'s own host (for github.com also api.github.com), https only; loopback may use http.',
    experimental_multiline: true,
    experimental_schema: credentialsText,
    default: "[]",
  },
  tokens: {
    type: "string",
    label: "Tokens",
    description:
      'JSON object from prefix to pasted token, e.g. {"github.com/org": "ghp_...", "jira:example.atlassian.net": "me@example.com:api-token"}. A Jira token is "email:api-token". A token is used only for the entry in Credentials whose "auth" is "token" and whose prefix is the same, and is sent only to that prefix\'s host. Tokens are read-only credentials for the plugin: it only reads.',
    secret: true,
    experimental_schema: tokensText,
  },
} as const;
