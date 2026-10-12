// A fake Linear: an in-memory team of issues behind the one GraphQL endpoint,
// answering the queries the Linear adapter sends (`IssueRead`, `IssueComments`,
// `CommentReplies`, `IssuesListed`) in Linear's documented shapes. It parses a
// query's selection set and returns only the fields asked for, so a query that
// leaves out a field the adapter needs fails here as it would on Linear. It
// evaluates the `IssueFilter` the adapter passes (`and`, `or`, `team.key`,
// `state.type`, `labels.name`, `assignee`, `creator`, `updatedAt` and the
// comparators `eq`, `eqIgnoreCase`, `in`, `nin`, `null`, `gt`, `gte`, `lt`,
// `lte`). Written in erasable TypeScript only, because the drive harness runs
// it with `node` directly.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FakeService } from "./listen";

export interface LinearUser {
  id: string;
  email: string;
  displayName: string;
}

export interface LinearHistory {
  id: string;
  createdAt: string;
  /** A user id, or null for an automation. */
  actor: string | null;
  /** A workflow state type such as `started`. */
  fromState?: string | null;
  toState?: string | null;
  addedLabels?: string[];
  removedLabels?: string[];
}

export interface LinearComment {
  id: string;
  createdAt: string;
  /** A user id, or null for an integration. */
  user: string | null;
  body: string;
  /** The id of the comment this one replies to. */
  parent?: string | null;
}

export interface LinearIssue {
  identifier: string;
  /** The team key; defaults to the identifier's prefix. */
  team?: string;
  url?: string;
  /** A workflow state type: triage, backlog, unstarted, started, completed, canceled or duplicate. */
  state: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  /** A user id, or null for nobody. */
  assignee: string | null;
  creator: string | null;
  history: LinearHistory[];
  comments: LinearComment[];
  /** Fields left out of the answer for this issue, as a way to script a half-failed read: `state`, `assignee`, `history`. */
  omit?: string[];
}

export interface LinearState {
  users: LinearUser[];
  issues: LinearIssue[];
  /** Answer every request with HTTP 401. */
  unauthenticated?: boolean;
  /** Answer every query with HTTP 200 and an authentication error in `errors`. */
  authenticationError?: boolean;
  /** Answer every request with the documented rate-limit response: HTTP 400 and code RATELIMITED. */
  rateLimited?: boolean;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: unknown };
interface Field {
  args: Record<string, unknown>;
  select: Map<string, Field>;
}

// ---- the query's selection set ----

const skipSpace = (text: string, at: number): number => {
  let i = at;
  while (i < text.length && /[\s,]/.test(text[i]!)) i += 1;
  return i;
};

const balanced = (text: string, at: number): number => {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && (depth -= 1) === 0) return i;
  }
  throw new Error("unbalanced parentheses");
};

const parseArgs = (text: string, variables: Record<string, unknown>): Record<string, unknown> => {
  const args: Record<string, unknown> = {};
  for (const part of text.split(",")) {
    const [name, ...rest] = part.split(":");
    if (name === undefined || rest.length === 0) continue;
    const raw = rest.join(":").trim();
    args[name.trim()] = raw.startsWith("$") ? variables[raw.slice(1)] : /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }
  return args;
};

const parseSet = (text: string, start: number, variables: Record<string, unknown>): { select: Map<string, Field>; end: number } => {
  const select = new Map<string, Field>();
  let i = skipSpace(text, start + 1);
  while (text[i] !== "}") {
    const name = /^[A-Za-z_]\w*/.exec(text.slice(i))?.[0];
    if (name === undefined) throw new Error(`cannot parse selection at ${i}`);
    i = skipSpace(text, i + name.length);
    let args: Record<string, unknown> = {};
    if (text[i] === "(") {
      const close = balanced(text, i);
      args = parseArgs(text.slice(i + 1, close), variables);
      i = skipSpace(text, close + 1);
    }
    let child = new Map<string, Field>();
    if (text[i] === "{") {
      const inner = parseSet(text, i, variables);
      child = inner.select;
      i = skipSpace(text, inner.end + 1);
    }
    select.set(name, { args, select: child });
  }
  return { select, end: i };
};

/** The operation's name and its root selection. */
const parseQuery = (query: string, variables: Record<string, unknown>): { name: string; select: Map<string, Field> } => {
  const head = /^\s*query\s+(\w+)/.exec(query);
  if (head === null) throw new Error("only named queries are served");
  let i = head[0].length;
  i = skipSpace(query, i);
  if (query[i] === "(") i = skipSpace(query, balanced(query, i) + 1);
  if (query[i] !== "{") throw new Error("no selection set");
  return { name: head[1]!, select: parseSet(query, i, variables).select };
};

// ---- filters ----

const COMPARATORS = new Set(["eq", "eqIgnoreCase", "neq", "in", "nin", "null", "gt", "gte", "lt", "lte"]);

const compare = (value: unknown, comparator: Obj): boolean =>
  Object.entries(comparator).every(([op, wanted]) => {
    if (op === "null") return (value === null || value === undefined) === wanted;
    if (value === null || value === undefined) return op === "neq" || op === "nin";
    const dates = typeof value === "string" && !Number.isNaN(Date.parse(value)) && typeof wanted === "string" && /^\d{4}-/.test(value);
    const a = dates ? Date.parse(value as string) : value;
    const b = dates ? Date.parse(wanted as string) : wanted;
    switch (op) {
      case "eq":
        return a === b;
      case "neq":
        return a !== b;
      case "eqIgnoreCase":
        return String(value).toLowerCase() === String(wanted).toLowerCase();
      case "in":
        return (wanted as unknown[]).includes(value);
      case "nin":
        return !(wanted as unknown[]).includes(value);
      case "gt":
        return (a as number) > (b as number);
      case "gte":
        return (a as number) >= (b as number);
      case "lt":
        return (a as number) < (b as number);
      case "lte":
        return (a as number) <= (b as number);
      default:
        throw new Error(`the fake does not know the comparator ${op}`);
    }
  });

const matches = (filter: Obj, node: Obj): boolean =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "and") return (condition as Obj[]).every((part) => matches(part, node));
    if (key === "or") return (condition as Obj[]).some((part) => matches(part, node));
    const value = node[key];
    const cond = condition as Obj;
    if (Array.isArray(value)) return value.some((entry) => matches(cond, entry as Obj));
    const isComparator = Object.keys(cond).length > 0 && Object.keys(cond).every((k) => COMPARATORS.has(k));
    if (isComparator) return compare(value, cond);
    if (value === null || value === undefined) return false;
    if (typeof value !== "object") throw new Error(`the fake cannot filter ${key}`);
    return matches(cond, value as Obj);
  });

// ---- the model as GraphQL objects ----

const user = (state: LinearState, id: string | null | undefined): Obj | null => {
  if (id === null || id === undefined) return null;
  const found = state.users.find((candidate) => candidate.id === id);
  return found === undefined ? { id, email: "", displayName: "" } : { ...found };
};

const stateOf = (type: string | null | undefined): Obj | null => (type === null || type === undefined ? null : { type });

const issueObject = (state: LinearState, issue: LinearIssue): Obj => {
  const object: Obj = {
    identifier: issue.identifier,
    url: issue.url ?? `https://linear.app/acme/issue/${issue.identifier}`,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    team: { key: issue.team ?? issue.identifier.split("-")[0] },
    state: stateOf(issue.state),
    assignee: user(state, issue.assignee),
    creator: user(state, issue.creator),
    labels: issue.labels.map((name) => ({ name })),
    // Linear lists the newest entry first; nothing in the adapter depends on it.
    history: [...issue.history]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        actor: user(state, entry.actor),
        fromState: stateOf(entry.fromState),
        toState: stateOf(entry.toState),
        addedLabels: (entry.addedLabels ?? []).map((name) => ({ name })),
        removedLabels: (entry.removedLabels ?? []).map((name) => ({ name })),
      })),
    comments: issue.comments.filter((comment) => !comment.parent).map((comment) => commentObject(state, issue, comment)),
  };
  for (const field of issue.omit ?? []) delete object[field];
  return object;
};

const commentObject = (state: LinearState, issue: LinearIssue, comment: LinearComment): Obj => ({
  id: comment.id,
  createdAt: comment.createdAt,
  body: comment.body,
  user: user(state, comment.user),
  children: issue.comments.filter((reply) => reply.parent === comment.id).map((reply) => commentObject(state, issue, reply)),
});

// ---- projecting an object through a selection ----

const pageOf = (list: unknown[], args: Record<string, unknown>): { nodes: unknown[]; pageInfo: Obj } => {
  const start = typeof args.after === "string" ? Number(args.after) : 0;
  const size = typeof args.first === "number" ? args.first : 50;
  const end = Math.min(start + size, list.length);
  return { nodes: list.slice(start, end), pageInfo: { hasNextPage: end < list.length, endCursor: end < list.length ? String(end) : null } };
};

const project = (value: unknown, field: Field): Json => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (field.select.has("nodes") || field.select.has("pageInfo")) {
      const page = pageOf(value, field.args);
      const out: { [key: string]: Json } = {};
      for (const [name, sub] of field.select) {
        if (name === "nodes") out.nodes = page.nodes.map((node) => project(node, sub));
        else if (name === "pageInfo") out.pageInfo = project(page.pageInfo, sub);
        else throw new Error(`the fake does not serve ${name} on a connection`);
      }
      return out;
    }
    return value.map((entry) => project(entry, field));
  }
  if (typeof value !== "object") return value as Json;
  if (field.select.size === 0) throw new Error("an object field needs a selection");
  const object = value as Obj;
  const out: { [key: string]: Json } = {};
  for (const [name, sub] of field.select) {
    if (!(name in object)) {
      if (name in OMITTABLE) continue;
      throw new Error(`the fake has no field ${name}`);
    }
    out[name] = sub.select.size === 0 && !Array.isArray(object[name]) ? (object[name] as Json) : project(object[name], sub);
  }
  return out;
};

/** Fields the model may leave out on purpose, which then are absent from the answer. */
const OMITTABLE: Record<string, true> = { state: true, assignee: true, history: true };

// ---- the service ----

const reply = (response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}): true => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
  return true;
};

const SORT_NEWEST = (a: LinearIssue, b: LinearIssue) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export function createFakeLinear(initial?: Partial<LinearState>): FakeService {
  let state: LinearState = { users: [], issues: [], ...initial };

  const find = (id: unknown): LinearIssue | undefined => state.issues.find((issue) => issue.identifier.toLowerCase() === String(id).toLowerCase());

  const answer = (name: string, select: Map<string, Field>, variables: Record<string, unknown>): Json => {
    const root = [...select.entries()][0];
    if (root === undefined) throw new Error("empty query");
    const [rootName, field] = root;
    const notFound = (what: string) => {
      throw new GraphQlError(`Entity not found: ${what}`, "INVALID_INPUT");
    };
    let value: unknown;
    if (name === "IssueRead" || name === "IssueComments") {
      const issue = find(field.args.id) ?? notFound("Issue");
      value = issueObject(state, issue!);
    } else if (name === "IssuesListed") {
      const filter = (variables.filter ?? {}) as Obj;
      const listed = state.issues.filter((issue) => matches(filter, issueObject(state, issue))).sort(SORT_NEWEST);
      value = listed.map((issue) => issueObject(state, issue));
    } else if (name === "CommentReplies") {
      for (const issue of state.issues) {
        const comment = issue.comments.find((candidate) => candidate.id === field.args.id);
        if (comment !== undefined) value = commentObject(state, issue, comment);
      }
      if (value === undefined) notFound("Comment");
    } else {
      throw new Error(`the fake does not serve the query ${name}`);
    }
    return { [rootName]: project(value, field) };
  };

  return {
    async handle(request: IncomingMessage, body: string, response: ServerResponse): Promise<boolean> {
      if (request.method !== "POST" || !(request.url ?? "").split("?")[0]!.endsWith("/graphql")) return false;
      if (state.unauthenticated === true || request.headers.authorization === undefined) {
        return reply(response, { errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] }, 401);
      }
      if (state.rateLimited === true) {
        return reply(response, { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] }, 400, { "x-ratelimit-requests-remaining": "0" });
      }
      if (state.authenticationError === true) {
        return reply(response, { errors: [{ message: "Authentication required", extensions: { type: "authentication error", code: "AUTHENTICATION_ERROR" } }] });
      }
      const { query, variables } = JSON.parse(body) as { query: string; variables?: Record<string, unknown> };
      if (/(^|[\s}])(mutation|subscription)\b/.test(query)) return reply(response, { errors: [{ message: "The fake serves queries only" }] }, 400);
      const vars = variables ?? {};
      try {
        const parsed = parseQuery(query, vars);
        const headers = { "x-ratelimit-requests-remaining": "2499", "x-complexity": "10" };
        return reply(response, { data: answer(parsed.name, parsed.select, vars) }, 200, headers);
      } catch (error) {
        if (error instanceof GraphQlError) return reply(response, { data: null, errors: [{ message: error.message, extensions: { code: error.code } }] });
        return reply(response, { errors: [{ message: String(error), extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] }, 400);
      }
    },
    setState(next: unknown) {
      state = { users: [], issues: [], ...(next as Partial<LinearState>) };
    },
    getState() {
      return state;
    },
  };
}

class GraphQlError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
