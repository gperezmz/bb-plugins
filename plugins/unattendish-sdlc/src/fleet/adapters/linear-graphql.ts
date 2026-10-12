// The Linear adapter's GraphQL documents and the shapes it accepts back. Every
// document is a query; the HTTP layer refuses anything that would write.
// Field names, filter inputs and comparators are those of Linear's public
// schema (github.com/linear/linear, packages/sdk/src/schema.graphql), which
// `linear.ts` lists page by page.
import { z } from "zod";
import { HttpError, type HttpSession } from "../application/ports";
import { parseAnswer, ReadProblem } from "./service-support";

/** Items per page: the default Linear documents for `first` (https://linear.app/developers/pagination), whose maximum the docs do not state. */
export const PAGE_SIZE = 50;

/** A connection page keeps its place by `endCursor`; the cut-off is `MAX_PAGES` pages. */
export const MAX_PAGES = 20;

/** Replies read inline under a comment before a follow-up query takes the rest. */
const INLINE_REPLIES = 20;

/** An issue's state, labels, people, and one page of its history. Called again with `after` for the next page of history. */
export const ISSUE_READ = `query IssueRead($id: String!, $after: String) {
  issue(id: $id) {
    identifier
    url
    updatedAt
    state { type }
    assignee { id email displayName }
    creator { id email displayName }
    labels(first: ${PAGE_SIZE}) { nodes { name } pageInfo { hasNextPage } }
    history(first: ${PAGE_SIZE}, after: $after) {
      nodes {
        id
        createdAt
        actor { id email displayName }
        fromState { type }
        toState { type }
        addedLabels { name }
        removedLabels { name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** One page of an issue's top-level comments, each with its first replies. */
export const ISSUE_COMMENTS = `query IssueComments($id: String!, $after: String) {
  issue(id: $id) {
    url
    comments(first: ${PAGE_SIZE}, after: $after) {
      nodes {
        id
        createdAt
        body
        user { id email displayName }
        children(first: ${INLINE_REPLIES}) {
          nodes { id createdAt body user { id email displayName } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** The replies of one comment past the first ones read inline. */
export const COMMENT_REPLIES = `query CommentReplies($id: String!, $after: String) {
  comment(id: $id) {
    children(first: ${PAGE_SIZE}, after: $after) {
      nodes { id createdAt body user { id email displayName } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** One page of the issues a filter selects, most recently updated first as far as `orderBy` says. */
export const ISSUES_LISTED = `query IssuesListed($filter: IssueFilter, $after: String) {
  issues(filter: $filter, first: ${PAGE_SIZE}, after: $after, orderBy: updatedAt) {
    nodes { identifier url updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ---- the shapes accepted back ----

const text = z.string().min(1);
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not a time");
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() });
const named = z.object({ name: text });
const typed = z.object({ type: text });

const person = z.object({ id: text, email: z.string().nullable().optional(), displayName: z.string().nullable().optional() });
export type Person = z.infer<typeof person>;

const historyEntry = z.object({
  id: text,
  createdAt: instant,
  actor: person.nullable(),
  fromState: typed.nullable(),
  toState: typed.nullable(),
  addedLabels: z.array(named).nullable(),
  removedLabels: z.array(named).nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntry>;

export const issueRead = z.object({
  issue: z.object({
    identifier: text,
    url: text,
    updatedAt: instant,
    state: typed,
    assignee: person.nullable(),
    creator: person.nullable(),
    labels: z.object({ nodes: z.array(named), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
    history: z.object({ nodes: z.array(historyEntry), pageInfo }),
  }),
});

const reply = z.object({ id: text, createdAt: instant, body: z.string(), user: person.nullable() });
export type Comment = z.infer<typeof reply>;
const replies = z.object({ nodes: z.array(reply), pageInfo });

export const issueComments = z.object({
  issue: z.object({
    url: text,
    comments: z.object({ nodes: z.array(reply.extend({ children: replies })), pageInfo }),
  }),
});

export const commentReplies = z.object({ comment: z.object({ children: replies }) });

export const issuesListed = z.object({
  issues: z.object({
    nodes: z.array(z.object({ identifier: text, url: text, updatedAt: instant })),
    pageInfo,
  }),
});

// ---- sending a query ----

/** A read of an issue that Linear says does not exist (or that the key may not see). */
export class NotFoundProblem extends ReadProblem {}

/**
 * Whether every error of an answer says an entity was not found. Linear's docs
 * (linear.app/developers/graphql) give no code or wording for it, so this
 * matches the message "Entity not found" alone; an answer worded otherwise is
 * an ordinary failure of the read.
 */
const isNotFound = (errors: readonly unknown[]): boolean =>
  errors.length > 0 && errors.every((error) => typeof (error as { message?: unknown } | null)?.message === "string" && /entity not found/i.test((error as { message: string }).message));

const codesOf = (error: unknown): string[] => {
  if (typeof error !== "object" || error === null) return [];
  const extensions = (error as { extensions?: unknown }).extensions;
  if (typeof extensions !== "object" || extensions === null) return [];
  return ["code", "type"].flatMap((key) => {
    const value = (extensions as Record<string, unknown>)[key];
    return typeof value === "string" ? [value.toUpperCase().replace(/[^A-Z]/g, "")] : [];
  });
};

/**
 * Throws the `HttpError` an answer's `errors` call for: `auth` for an
 * authentication error, `rate-limit` for a rate-limit error, and `forbidden`
 * for a key that may not read the entity (which fails that one read).
 *
 * What Linear's own sources settle: the SDK (github.com/linear/linear,
 * packages/sdk/src/error.ts and types.ts) reads `extensions.type` and knows
 * the values `authentication error`, `forbidden` and `ratelimited`; the rate
 * limit page names `extensions.code` `RATELIMITED`. Neither says which status
 * a refused key is answered with or whether `code` is set, so both fields
 * are read, with case, spaces and underscores ignored, and an authentication
 * error is taken wherever it comes: HTTP 200 with `errors`, a 401, or an HTTP 400
 * whose error codes the HTTP layer kept.
 */
export const rethrowFatal = (errors: readonly unknown[]): void => {
  const codes = errors.flatMap(codesOf);
  if (codes.some((code) => code.includes("AUTHENTICATION") || code.includes("UNAUTHENTICATED") || code === "UNAUTHORIZED"))
    throw new HttpError("auth", "POST graphql answered an authentication error");
  if (codes.some((code) => code.includes("RATELIMIT"))) throw new HttpError("rate-limit", "POST graphql was rate limited");
  if (codes.some((code) => code === "FORBIDDEN")) throw new HttpError("forbidden", "POST graphql answered forbidden");
};

/**
 * Sends one query and returns its `data` checked against `schema`. Throws
 * `HttpError` for what the whole read must fail on (`auth`, `rate-limit`) and
 * for transport trouble, and `ReadProblem` for an answer that is not usable.
 */
export async function send<T>(
  http: HttpSession,
  signal: AbortSignal,
  document: string,
  variables: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  let response;
  try {
    response = await http.request({ method: "POST", path: "", graphql: { query: document, variables } }, { signal });
  } catch (error) {
    // Linear answers a revoked key or a rate limit as HTTP 400 with GraphQL errors; the HTTP layer keeps only their codes.
    if (error instanceof HttpError && error.graphql !== undefined) rethrowFatal(error.graphql.map((entry) => ({ extensions: { type: entry.type ?? undefined, code: entry.code ?? undefined } })));
    throw error;
  }
  const body = response.json;
  if (typeof body !== "object" || body === null) throw new ReadProblem("Linear answered a body that is not a GraphQL response");
  const { data, errors } = body as { data?: unknown; errors?: unknown };
  if (Array.isArray(errors)) rethrowFatal(errors);
  if (data === null || data === undefined || typeof data !== "object") {
    if (Array.isArray(errors) && isNotFound(errors)) throw new NotFoundProblem("Linear answered that the entity was not found");
    throw new ReadProblem(Array.isArray(errors) && errors.length > 0 ? "Linear answered errors and no data" : "Linear answered no data");
  }
  return parseAnswer(schema, data, { root: "(root)", limit: 5, message: (fields) => `Linear answered without a field a change depends on: ${fields}` });
}
