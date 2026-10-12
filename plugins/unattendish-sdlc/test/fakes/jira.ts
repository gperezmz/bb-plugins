// A fake Jira Cloud site: an in-memory model of issues, comments, changelogs,
// users and statuses, answering the REST v3 endpoints the Jira adapter reads
// with the shapes Atlassian's OpenAPI description gives them:
//
//   GET /rest/api/3/search/jql          token-paged (`nextPageToken`, `isLast`), JQL subset below
//   GET /rest/api/3/issue/{key}         `fields=` and `expand=changelog` (newest first, with `total`); a key the issue
//                                       had before a move answers the issue under its current key, with no redirect
//   GET /rest/api/3/issue/{key}/changelog   `startAt`/`maxResults` pages, oldest first, `isLast`
//   GET /rest/api/3/issue/{key}/comment     `startAt`/`maxResults`/`orderBy`, `total`
//   GET /rest/api/3/status              every status with its category
//
// The JQL it understands is what the adapter sends: `AND`/`OR`/parentheses over
// `project`, `labels`, `statusCategory`, `assignee`, `creator` (`=`, `!=`, `in`,
// `is [not] EMPTY`) and `updated >=` (absolute `yyyy/MM/dd HH:mm` or relative
// `-Nm|h|d|w`, both to the minute, in UTC), then `ORDER BY updated`. Any other
// JQL is answered 400, so a malformed query fails a test instead of passing.
//
// Anything before `/rest/api/3` in the path is ignored, so a credential's base
// URL may carry a prefix. Written in erasable TypeScript only (no enums,
// namespaces or parameter properties): the drive harness runs it with `node`.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FakeService } from "./listen";

export interface FakeJiraUser {
  accountId: string;
  /** Null when the user's privacy settings hide it. */
  emailAddress: string | null;
  displayName: string;
  /** An email the service matches in JQL (`assignee = "..."`) but does not show in its answers, as with a user whose privacy settings hide it. */
  hiddenEmail?: string | null;
}

export interface FakeJiraStatus {
  id: string;
  name: string;
  category: "new" | "indeterminate" | "done";
}

export interface FakeJiraComment {
  id: string;
  /** An account id; null for a comment with no author. */
  author: string | null;
  /** Jira's timestamp form: `2026-10-12T10:00:00.000+0000`. */
  created: string;
  /** Plain text: each line becomes one ADF paragraph. */
  text?: string;
  /** A raw body, sent as is, in place of `text`. */
  body?: unknown;
}

export interface FakeJiraHistoryItem {
  field: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

export interface FakeJiraHistory {
  id: string;
  /** An account id; null for a change with no author. */
  author: string | null;
  created: string;
  items: FakeJiraHistoryItem[];
}

export interface FakeJiraIssue {
  id: string;
  key: string;
  /** A status id from `statuses`. */
  status: string;
  labels: string[];
  assignee: string | null;
  creator: string;
  updated: string;
  /**
   * Keys the issue had before it was moved. Asking for one answers the issue under its current `key`, with no redirect,
   * as the getIssue operation documents.
   */
  formerKeys?: string[];
  /** Written on the service; the adapter must never pass it on. */
  summary?: string;
  comments?: FakeJiraComment[];
  /** Oldest first. */
  changelog?: FakeJiraHistory[];
  /** Names of `fields` the service leaves out of its answer. */
  omit?: string[];
}

export interface FakeJiraSettings {
  /** Caps every page of every list; null for the service's own sizes. */
  pageSize: number | null;
  /** Sends an ETag and answers `If-None-Match` with 304. Atlassian does not document either for these endpoints. */
  etag: boolean;
  /** Keys of issues every search lists whatever its JQL says, as a service that leaked another project's issues into a listing would. */
  alsoListed: string[];
  /** Answers any request whose path contains `pathContains` with `status`. */
  failures: { pathContains: string; status: number; headers?: Record<string, string> }[];
}

export interface FakeJiraState {
  /** The fake's clock for relative JQL dates, in Jira's form; null for the real one. */
  now: string | null;
  users: FakeJiraUser[];
  statuses: FakeJiraStatus[];
  issues: FakeJiraIssue[];
  settings: FakeJiraSettings;
}

export const DEFAULT_STATUSES: FakeJiraStatus[] = [
  { id: "10000", name: "To Do", category: "new" },
  { id: "10001", name: "In Progress", category: "indeterminate" },
  { id: "10002", name: "Done", category: "done" },
];

const CATEGORY_NAMES = { new: "To Do", indeterminate: "In Progress", done: "Done" };
const CATEGORY_IDS = { new: 2, indeterminate: 4, done: 3 };

/** Jira's timestamp form for an instant: `2026-10-12T10:00:00.000+0000`. */
export const jiraTime = (date: Date): string => date.toISOString().replace("Z", "+0000");

const parseTime = (text: string): number => Date.parse(text.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
const toMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

const normalise = (raw: Partial<FakeJiraState> | undefined): FakeJiraState => ({
  now: raw?.now ?? null,
  users: raw?.users ?? [],
  statuses: raw?.statuses ?? DEFAULT_STATUSES,
  issues: raw?.issues ?? [],
  settings: { pageSize: raw?.settings?.pageSize ?? null, etag: raw?.settings?.etag ?? false, alsoListed: raw?.settings?.alsoListed ?? [], failures: raw?.settings?.failures ?? [] },
});

// ---- JQL ----

type Token = { kind: "str" | "word" | "op" | "paren" | "comma"; text: string };

const tokenize = (jql: string): Token[] => {
  const tokens: Token[] = [];
  const pattern = /\s*(?:"((?:\\.|[^"\\])*)"|(>=|<=|!=|=|>|<)|([(),])|([^\s()",=!<>]+(?:\(\))?))/y;
  let position = 0;
  while (position < jql.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(jql);
    if (match === null) {
      if (jql.slice(position).trim() === "") break;
      throw new Error(`unexpected text at ${position}`);
    }
    position = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: "str", text: match[1].replace(/\\(.)/g, "$1") });
    else if (match[2] !== undefined) tokens.push({ kind: "op", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: match[3] === "," ? "comma" : "paren", text: match[3] });
    else tokens.push({ kind: "word", text: match[4]! });
  }
  return tokens;
};

type Test = (issue: FakeJiraIssue, ctx: JqlContext) => boolean;
interface JqlContext {
  now: number;
  state: FakeJiraState;
}

const parseDate = (value: string, now: number): number => {
  const relative = /^-?(\d+)([wdhm]?)$/.exec(value);
  if (relative !== null) {
    const unit = { w: 7 * 86_400_000, d: 86_400_000, h: 3_600_000, m: 60_000, "": 60_000 }[relative[2] as "w" | "d" | "h" | "m" | ""];
    return toMinute(now - Number(relative[1]) * unit);
  }
  const absolute = /^(\d{4})[/-](\d\d)[/-](\d\d)(?: (\d\d):(\d\d))?$/.exec(value);
  if (absolute === null) throw new Error(`unsupported date ${value}`);
  return Date.UTC(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]), Number(absolute[4] ?? 0), Number(absolute[5] ?? 0));
};

const matchesUser = (state: FakeJiraState, accountId: string | null, value: string): boolean => {
  if (accountId === null) return false;
  const wanted = value.toLowerCase();
  if (accountId.toLowerCase() === wanted) return true;
  const user = state.users.find((candidate) => candidate.accountId === accountId);
  return user?.emailAddress?.toLowerCase() === wanted || user?.hiddenEmail?.toLowerCase() === wanted;
};

const parseJql = (jql: string): { test: Test; orderBy: string | null } => {
  const all = tokenize(jql);
  const orderAt = all.findIndex((token, i) => token.kind === "word" && /^order$/i.test(token.text) && /^by$/i.test(all[i + 1]?.text ?? ""));
  const tokens = orderAt < 0 ? all : all.slice(0, orderAt);
  const orderBy = orderAt < 0 ? null : (all[orderAt + 2]?.text.toLowerCase() ?? null);
  let at = 0;
  const peek = () => tokens[at];
  const word = (): string => {
    const token = tokens[at++];
    if (token === undefined || (token.kind !== "word" && token.kind !== "str")) throw new Error("expected a value");
    return token.text;
  };
  const keyword = (name: string): boolean => {
    const token = peek();
    if (token !== undefined && token.kind === "word" && token.text.toLowerCase() === name) {
      at += 1;
      return true;
    }
    return false;
  };
  const values = (): string[] => {
    if (peek()?.text !== "(") return [word()];
    at += 1;
    const found = [word()];
    while (peek()?.kind === "comma") {
      at += 1;
      found.push(word());
    }
    if (tokens[at++]?.text !== ")") throw new Error("expected )");
    return found;
  };
  const primary = (): Test => {
    if (peek()?.text === "(") {
      at += 1;
      const inner = orExpression();
      if (tokens[at++]?.text !== ")") throw new Error("expected )");
      return inner;
    }
    const field = word().toLowerCase();
    let negate = false;
    let op: string;
    if (keyword("is")) {
      negate = keyword("not");
      if (!keyword("empty")) throw new Error("expected EMPTY");
      return (issue) => emptiness(field, issue) !== negate;
    }
    if (keyword("not")) {
      negate = true;
      if (!keyword("in")) throw new Error("expected IN");
      op = "in";
    } else if (keyword("in")) {
      op = "in";
    } else {
      const token = tokens[at++];
      if (token === undefined || token.kind !== "op") throw new Error("expected an operator");
      op = token.text;
      if (op === "!=") {
        negate = true;
        op = "=";
      }
    }
    const operands = values();
    return (issue, ctx) => compare(field, op, operands, issue, ctx) !== negate;
  };
  const andExpression = (): Test => {
    let left = primary();
    while (keyword("and")) {
      const a = left;
      const b = primary();
      left = (issue, ctx) => a(issue, ctx) && b(issue, ctx);
    }
    return left;
  };
  const orExpression = (): Test => {
    let left = andExpression();
    while (keyword("or")) {
      const a = left;
      const b = andExpression();
      left = (issue, ctx) => a(issue, ctx) || b(issue, ctx);
    }
    return left;
  };
  const test = orExpression();
  if (at < tokens.length) throw new Error("unexpected trailing text");
  return { test, orderBy };
};

const emptiness = (field: string, issue: FakeJiraIssue): boolean => {
  if (field === "assignee") return issue.assignee === null;
  if (field === "labels") return issue.labels.length === 0;
  throw new Error(`unsupported IS EMPTY on ${field}`);
};

const compare = (field: string, op: string, operands: string[], issue: FakeJiraIssue, ctx: JqlContext): boolean => {
  const lower = operands.map((operand) => operand.toLowerCase());
  switch (field) {
    case "project":
      return lower.includes(issue.key.slice(0, issue.key.lastIndexOf("-")).toLowerCase());
    case "labels":
      return issue.labels.some((label) => lower.includes(label.toLowerCase()));
    case "statuscategory": {
      const status = ctx.state.statuses.find((candidate) => candidate.id === issue.status);
      if (status === undefined) return false;
      return lower.includes(status.category) || lower.includes(CATEGORY_NAMES[status.category].toLowerCase());
    }
    case "assignee":
      return operands.some((operand) => matchesUser(ctx.state, issue.assignee, operand));
    case "creator":
      return operands.some((operand) => matchesUser(ctx.state, issue.creator, operand));
    case "updated": {
      const bound = parseDate(operands[0]!, ctx.now);
      const value = toMinute(parseTime(issue.updated));
      if (op === ">=") return value >= bound;
      if (op === ">") return value > bound;
      if (op === "<=") return value <= bound;
      if (op === "<") return value < bound;
      throw new Error(`unsupported operator ${op} on updated`);
    }
    default:
      throw new Error(`unsupported field ${field}`);
  }
};

// ---- answers ----

const userBean = (state: FakeJiraState, accountId: string | null) => {
  if (accountId === null) return null;
  const user = state.users.find((candidate) => candidate.accountId === accountId);
  if (user === undefined) return { accountId };
  return { accountId, displayName: user.displayName, emailAddress: user.emailAddress, active: true, accountType: "atlassian" };
};

const statusBean = (state: FakeJiraState, status: FakeJiraStatus) => ({
  id: status.id,
  name: status.name,
  statusCategory: { id: CATEGORY_IDS[status.category], key: status.category, name: CATEGORY_NAMES[status.category] },
});

const allFields = (state: FakeJiraState, issue: FakeJiraIssue): Record<string, unknown> => {
  const status = state.statuses.find((candidate) => candidate.id === issue.status);
  return {
    status: status === undefined ? null : statusBean(state, status),
    labels: issue.labels,
    assignee: userBean(state, issue.assignee),
    creator: userBean(state, issue.creator),
    updated: issue.updated,
    project: { key: issue.key.slice(0, issue.key.lastIndexOf("-")) },
    summary: issue.summary ?? `Title of ${issue.key}`,
  };
};

const pickFields = (state: FakeJiraState, issue: FakeJiraIssue, wanted: Set<string> | null): Record<string, unknown> => {
  const fields = allFields(state, issue);
  for (const name of issue.omit ?? []) delete fields[name];
  if (wanted === null || wanted.has("*all") || wanted.has("*navigable")) return fields;
  return Object.fromEntries(Object.entries(fields).filter(([name]) => wanted.has(name)));
};

const historyBean = (state: FakeJiraState, history: FakeJiraHistory) => ({
  id: history.id,
  author: userBean(state, history.author) ?? undefined,
  created: history.created,
  items: history.items.map((item) => ({ ...item, fieldtype: "jira", fieldId: item.field })),
});

const commentBody = (comment: FakeJiraComment): unknown => {
  if (comment.body !== undefined) return comment.body;
  const lines = (comment.text ?? "").split("\n");
  return {
    version: 1,
    type: "doc",
    content: lines.map((line) => (line === "" ? { type: "paragraph", content: [] } : { type: "paragraph", content: [{ type: "text", text: line }] })),
  };
};

const commentBean = (state: FakeJiraState, comment: FakeJiraComment) => ({
  id: comment.id,
  author: userBean(state, comment.author) ?? undefined,
  body: commentBody(comment),
  created: comment.created,
  updated: comment.created,
});

const NOT_FOUND = { errorMessages: ["Issue does not exist or you do not have permission to see it."], errors: {} };

export function createFakeJira(initial?: Partial<FakeJiraState>): FakeService {
  let state = normalise(initial);

  const send = (request: IncomingMessage, response: ServerResponse, body: unknown, status = 200): void => {
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (state.settings.etag && status === 200) {
      const etag = `"${createHash("sha1").update(text).digest("hex")}"`;
      headers.etag = etag;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag });
        response.end();
        return;
      }
    }
    response.writeHead(status, headers);
    response.end(text);
  };

  const pageSize = (asked: string | null, fallback: number): number => {
    const wanted = asked === null ? fallback : Number(asked);
    return Math.max(1, Math.min(wanted, state.settings.pageSize ?? Number.MAX_SAFE_INTEGER));
  };

  const find = (key: string): FakeJiraIssue | undefined => {
    const wanted = key.toLowerCase();
    return state.issues.find((issue) => issue.key.toLowerCase() === wanted) ?? state.issues.find((issue) => (issue.formerKeys ?? []).some((former) => former.toLowerCase() === wanted));
  };

  const handle = (request: IncomingMessage, _body: string, response: ServerResponse): boolean => {
    const url = new URL(request.url ?? "/", "http://fake");
    const at = url.pathname.indexOf("/rest/api/3/");
    if (at < 0) return false;
    const path = url.pathname.slice(at + "/rest/api/3".length);
    const query = url.searchParams;

    if (request.method !== "GET") {
      send(request, response, { errorMessages: ["The fake answers reads only."] }, 405);
      return true;
    }
    if (request.headers.authorization === undefined) {
      send(request, response, { message: "Unauthorized" }, 401);
      return true;
    }
    for (const failure of state.settings.failures) {
      if (url.pathname.includes(failure.pathContains)) {
        response.writeHead(failure.status, { "content-type": "application/json", ...failure.headers });
        response.end(JSON.stringify({ errorMessages: ["failed on purpose"] }));
        return true;
      }
    }

    if (path === "/search/jql") {
      let parsed: ReturnType<typeof parseJql>;
      const jql = query.get("jql");
      try {
        if (jql === null) throw new Error("jql is required");
        parsed = parseJql(jql);
      } catch (error) {
        send(request, response, { errorMessages: [`Error in the JQL Query: ${String(error)}`], errors: {} }, 400);
        return true;
      }
      if (parsed.orderBy !== null && parsed.orderBy !== "updated" && parsed.orderBy !== "key") {
        send(request, response, { errorMessages: ["unsupported ORDER BY"], errors: {} }, 400);
        return true;
      }
      const ctx: JqlContext = { now: state.now === null ? Date.now() : parseTime(state.now), state };
      const hits = state.issues.filter((issue) => parsed.test(issue, ctx) || state.settings.alsoListed.includes(issue.key));
      if (parsed.orderBy === "updated") hits.sort((a, b) => parseTime(a.updated) - parseTime(b.updated));
      const offset = Number(Buffer.from(query.get("nextPageToken") ?? "MA", "base64url").toString() || "0");
      const size = pageSize(query.get("maxResults"), 50);
      const page = hits.slice(offset, offset + size);
      const wanted = new Set((query.getAll("fields").length === 0 ? ["id"] : query.getAll("fields")).flatMap((value) => value.split(",")));
      const last = offset + size >= hits.length;
      send(request, response, {
        issues: page.map((issue) => ({ id: issue.id, key: issue.key, self: `/rest/api/3/issue/${issue.id}`, fields: pickFields(state, issue, wanted) })),
        ...(last ? {} : { nextPageToken: Buffer.from(String(offset + size)).toString("base64url") }),
        isLast: last,
      });
      return true;
    }

    if (path === "/status") {
      send(request, response, state.statuses.map((status) => statusBean(state, status)));
      return true;
    }

    const issuePath = /^\/issue\/([^/]+)(?:\/(changelog|comment))?$/.exec(path);
    if (issuePath === null) return false;
    const issue = find(decodeURIComponent(issuePath[1]!));
    if (issue === undefined) {
      send(request, response, NOT_FOUND, 404);
      return true;
    }

    if (issuePath[2] === undefined) {
      const wanted = query.getAll("fields").length === 0 ? null : new Set(query.getAll("fields").flatMap((value) => value.split(",")));
      const body: Record<string, unknown> = { id: issue.id, key: issue.key, self: `/rest/api/3/issue/${issue.id}`, fields: pickFields(state, issue, wanted) };
      if ((query.get("expand") ?? "").split(",").includes("changelog")) {
        const newestFirst = [...(issue.changelog ?? [])].reverse();
        const histories = newestFirst.slice(0, Math.min(100, state.settings.pageSize ?? 100)).map((history) => historyBean(state, history));
        body.changelog = { startAt: 0, maxResults: histories.length, total: newestFirst.length, histories };
      }
      send(request, response, body);
      return true;
    }

    const startAt = Number(query.get("startAt") ?? 0);
    if (issuePath[2] === "changelog") {
      const size = pageSize(query.get("maxResults"), 100);
      const all = issue.changelog ?? [];
      send(request, response, {
        self: url.pathname,
        startAt,
        maxResults: size,
        total: all.length,
        isLast: startAt + size >= all.length,
        values: all.slice(startAt, startAt + size).map((history) => historyBean(state, history)),
      });
      return true;
    }

    const orderBy = query.get("orderBy");
    if (orderBy !== null && !["created", "-created", "+created"].includes(orderBy)) {
      send(request, response, { errorMessages: ["bad orderBy"], errors: {} }, 400);
      return true;
    }
    const size = pageSize(query.get("maxResults"), 100);
    const ordered = [...(issue.comments ?? [])].sort((a, b) => parseTime(a.created) - parseTime(b.created));
    if (orderBy === "-created") ordered.reverse();
    send(request, response, {
      startAt,
      maxResults: size,
      total: ordered.length,
      comments: ordered.slice(startAt, startAt + size).map((comment) => commentBean(state, comment)),
    });
    return true;
  };

  return {
    handle,
    setState: (next) => {
      state = normalise(next as Partial<FakeJiraState>);
    },
    getState: () => state,
  };
}
