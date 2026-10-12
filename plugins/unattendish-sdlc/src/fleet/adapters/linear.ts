// The Linear adapter: reads a team's issues through Linear's GraphQL API and
// normalises them. It decides nothing about waking.
//
// What each part rests on, from Linear's own documentation (read 2026-10-12):
//  - https://linear.app/developers/graphql: the one endpoint (the credential's
//    base URL, path ""), a personal API key sent as `Authorization: <key>` and
//    an OAuth token as `Bearer <token>` (the HTTP layer does both), and
//    `issue(id:)` taking an identifier such as `ENG-212`.
//  - https://linear.app/developers/pagination: `first`/`after`,
//    `pageInfo.hasNextPage` and `endCursor`; 50 items by default.
//  - https://linear.app/developers/filtering: `labels: {name: {...}}` matches an
//    issue with at least one such label; `and` and `or` combine filters.
//  - https://linear.app/developers/rate-limiting: each request counts against
//    the hour's request allowance, so every request is recorded as counted; a
//    limited request is HTTP 400 with the error code `RATELIMITED`.
//  - Linear's public schema (github.com/linear/linear,
//    packages/sdk/src/schema.graphql): `Query.issues(filter, first, after,
//    orderBy)` with `PaginationOrderBy` `createdAt | updatedAt`; `IssueFilter`
//    `team.key`, `state.type`, `labels`, `assignee`, `creator` (`NullableUserFilter`
//    with `id`, `email`, `displayName`, `null`) and `updatedAt: DateComparator`
//    (`gte` among its comparators); `StringComparator` `eqIgnoreCase` and
//    `nin`; `Issue.history` (`IssueHistory`: `id`, `createdAt`, `actor`,
//    `fromState`, `toState`, `addedLabels`, `removedLabels`); `Issue.comments`
//    and `Comment.children`; `WorkflowState.type`, a string documented as one of
//    triage, backlog, unstarted, started, completed, canceled, duplicate.
//
// The docs leave these unconfirmed, and the adapter takes the cheapest
// fallback for each:
//  - The direction of `orderBy` and of `history`: nothing relies on it. Every
//    page of a history is read and filtered by time here, and a listing is
//    filtered by `updatedAt: {gte: since}`, not cut at a cursor.
//  - Whether a listing can run oldest first: https://linear.app/developers/pagination gives `orderBy: updatedAt` only
//    "to get most recently updated resources", and the other pages read give no direction argument, so the listing
//    of updates is taken to run newest first. A listing cut off at its page limit then lacks the oldest changes, and
//    the cursor cannot move to where it stopped: the cut-off is a failure with no ref, never a `listingCutAt`.
//  - The maximum page size: pages are 50, the documented default.
//  - The status and error of a refused key: the SDK (packages/sdk/src/error.ts,
//    types.ts) knows `extensions.type` values `authentication error` and
//    `forbidden`, and the docs give no status or `code` for either, so an
//    authentication error is matched wherever it comes (see `rethrowFatal`).
//    An HTTP 401 is the layer's `auth`, and a 403 that is no rate limit, or a
//    `forbidden` type, fails the one read as `forbidden`. An HTTP 400 (the
//    documented status of a rate limit) arrives with the GraphQL error codes
//    the HTTP layer keeps (`HttpError.graphql`); `send` turns the ones it knows
//    into the error they mean, and a 400 with no known code fails the one read
//    with no kind.
//  - What `issue(id:)` answers for an identifier the issue had before a move to another team: Linear's help center
//    (linear.app/docs/move-to-new-team, excerpt only; the page itself answered 404) says a moved issue gets a new
//    identifier and a search for the old one returns the current issue, and its API pages say nothing. The answer's
//    `identifier` is checked against the fleet's team whichever way it answers, so a moved issue is refused if it
//    comes back under another team's key and a 404 is a plain not-found.
//  - The answer for an issue that does not exist: no page gives its code or
//    wording, so an answer whose every error says "Entity not found" and has
//    no data is taken as not-found, and any other as an ordinary failure.
//  - Whether `Issue.comments` lists replies: every comment of the issue is
//    read with its replies nested, and replies are de-duplicated by id.
//  - Whether every label change reaches `addedLabels`/`removedLabels`: it is
//    taken that it does.
//  - Conditional requests: not documented for GraphQL, and the HTTP layer
//    caches GETs only, so none is made.
//
// `duplicate` counts as a closed state with `completed` and `canceled`.
import type { z } from "zod";
import type { ReadRequest, ServiceAdapter } from "../application/ports";
import { HttpError } from "../application/ports";
import type { ActivityEvent, FleetLabels, ItemSnapshot, ReadFailure, ReadOutcome, Transition, UpdatedItem } from "../domain/model";
import { lastLine } from "../domain/text";
import {
  COMMENT_REPLIES,
  commentReplies,
  ISSUE_COMMENTS,
  ISSUE_READ,
  ISSUES_LISTED,
  issueComments,
  issueRead,
  issuesListed,
  MAX_PAGES,
  NotFoundProblem,
  send,
  type Comment,
  type HistoryEntry,
  type Person,
} from "./linear-graphql";
import { failureOf, isFatal, ReadProblem } from "./service-support";

const CLOSED_TYPES = ["completed", "canceled", "duplicate"];
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `operator` names the person, by email, display name or account id, ignoring case. */
export const isOperator = (person: Person | null, operator: string): boolean => {
  if (person === null) return false;
  const wanted = operator.trim().toLowerCase();
  return [person.email, person.displayName, person.id].some((value) => typeof value === "string" && value.toLowerCase() === wanted);
};

/**
 * The email address Linear shows for a person, which an echo actor may have been registered under; the user id is the
 * actor itself. A display name is never an alias: anyone can choose one, so a teammate could pass for an echo actor.
 */
const aliasesOf = (person: Person | null): { actorAliases?: string[] } => {
  const email = person?.email;
  return typeof email === "string" && email.trim() !== "" ? { actorAliases: [email] } : {};
};

const atOrAfter = (at: string, since: string): boolean => Date.parse(at) >= Date.parse(since);

/** The registered spelling of each of the four labels that `names` includes, compared ignoring case. */
const fleetLabelsIn = (names: readonly string[], labels: FleetLabels): string[] => {
  const present = new Set(names.map((name) => name.toLowerCase()));
  return [...new Set([labels.spec, labels.ready, labels.inProgress, labels.needsInput])].filter((label) => present.has(label.toLowerCase()));
};

const isClosedType = (type: string): boolean => CLOSED_TYPES.includes(type);

const transitionsOf = (history: readonly HistoryEntry[], labels: FleetLabels, since: string): Transition[] => {
  const registered = new Map([labels.spec, labels.ready, labels.inProgress, labels.needsInput].map((label) => [label.toLowerCase(), label]));
  const found: Transition[] = [];
  const ordered = history.filter((entry) => atOrAfter(entry.createdAt, since)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const actor = entry.actor?.id ?? null;
    const aliases = aliasesOf(entry.actor);
    const id = `linear:history:${entry.id}`;
    if (entry.toState !== null) {
      const toClosed = isClosedType(entry.toState.type);
      const fromClosed = entry.fromState !== null && isClosedType(entry.fromState.type);
      if (toClosed && !fromClosed) found.push({ kind: "closed", actor, ...aliases, at: entry.createdAt, id });
      else if (!toClosed && fromClosed) found.push({ kind: "reopened", actor, ...aliases, at: entry.createdAt, id });
    }
    for (const [kind, names] of [["labelled", entry.addedLabels], ["unlabelled", entry.removedLabels]] as const) {
      for (const name of names ?? []) {
        const label = registered.get(name.name.toLowerCase());
        if (label !== undefined) found.push({ kind, label, actor, ...aliases, at: entry.createdAt, id: `${id}:${kind}:${label}` });
      }
    }
  }
  return found;
};

/** An issue whose identifier belongs to a team other than the fleet's. */
class OutsideFleet extends ReadProblem {}

/** The team key of an identifier (`ENG` of `ENG-12`). */
const teamOf = (identifier: string): string => identifier.slice(0, identifier.lastIndexOf("-"));

const failureReason = (error: unknown): string => {
  if (error instanceof ReadProblem) return error.message;
  if (error instanceof HttpError) return error.message;
  return "Linear answered something the adapter could not read";
};


class LinearAdapter implements ServiceAdapter {
  readonly service = "linear" as const;

  async read(request: ReadRequest): Promise<ReadOutcome> {
    if (request.source.service !== "linear") throw new Error("The Linear adapter was given another service's source");
    const team = request.source.team;
    const snapshots: ItemSnapshot[] = [];
    const events: ActivityEvent[] = [];
    const updated: UpdatedItem[] = [];
    const failures: ReadFailure[] = [];
    const read = new Set<string>();

    const item = async (ref: string, withEvents: boolean): Promise<void> => {
      read.add(ref.toUpperCase());
      try {
        const result = await this.readItem(request, ref, withEvents);
        snapshots.push(result.snapshot);
        events.push(...result.events);
      } catch (error) {
        if (isFatal(error) || request.signal.aborted) throw error;
        failures.push(
          error instanceof OutsideFleet
            ? { ref, reason: error.message, kind: "outside-fleet" }
            : error instanceof NotFoundProblem
              ? { ref, reason: failureReason(error), kind: "not-found" }
              : failureOf(ref, error, failureReason(error)),
        );
      }
    };

    /** Whether a listing's hit belongs to another team, which is recorded as a failure and never read. */
    const refuseListed = (ref: string): boolean => {
      if (teamOf(ref).toLowerCase() === team.toLowerCase()) return false;
      failures.push({ ref, reason: "listed outside the fleet", kind: "outside-fleet" });
      return true;
    };

    for (const watched of request.items) {
      request.signal.throwIfAborted();
      await item(watched.ref, !request.stateOnly && request.watchedRefs.has(watched.ref));
    }

    if (request.scanPartition && !request.stateOnly) {
      const listed = await this.list(request, scanFilter(team, request.labels, request.operator), failures);
      for (const found of listed) {
        request.signal.throwIfAborted();
        if (refuseListed(found.ref)) continue;
        if (!read.has(found.ref.toUpperCase())) await item(found.ref, false);
      }
    }

    if (!request.stateOnly) {
      const since = { team: { key: { eq: team } }, updatedAt: { gte: request.since } };
      for (const found of await this.list(request, since, failures)) {
        if (refuseListed(found.ref)) continue;
        updated.push({ role: "tracker", ref: found.ref, url: found.url, at: found.at });
      }
    }

    return { snapshots, events: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)), updated, failures };
  }

  private async readItem(request: ReadRequest, ref: string, withEvents: boolean): Promise<{ snapshot: ItemSnapshot; events: ActivityEvent[] }> {
    if (!IDENTIFIER.test(ref)) throw new ReadProblem(`${ref} is not a Linear issue identifier`);
    const { http, signal } = request;
    let page = await send(http, signal, ISSUE_READ, { id: ref }, issueRead);
    const issue = page.issue;
    if (request.source.service !== "linear" || teamOf(issue.identifier).toLowerCase() !== request.source.team.toLowerCase()) throw new OutsideFleet("moved outside the fleet");
    if (issue.labels.pageInfo.hasNextPage) throw new ReadProblem(`${ref} carries more labels than one page holds`);
    const history = [...issue.history.nodes];
    for (let pages = 1; page.issue.history.pageInfo.hasNextPage; pages += 1) {
      const cursor = page.issue.history.pageInfo.endCursor;
      if (pages >= MAX_PAGES || typeof cursor !== "string") throw new ReadProblem(`${ref}'s history was cut off after ${pages} pages`);
      page = await send(http, signal, ISSUE_READ, { id: ref, after: cursor }, issueRead);
      history.push(...page.issue.history.nodes);
    }

    const closed = isClosedType(issue.state.type);
    const partition = isOperator(issue.assignee, request.operator) || (issue.assignee === null && isOperator(issue.creator, request.operator));
    const snapshot: ItemSnapshot = {
      role: "tracker",
      ref,
      url: issue.url,
      open: !closed,
      merged: false,
      fleetLabels: fleetLabelsIn(issue.labels.nodes.map((label) => label.name), request.labels),
      checks: null,
      inPartition: partition,
      transitions: transitionsOf(history, request.labels, request.since),
    };
    return { snapshot, events: withEvents ? await this.commentsOf(request, ref, issue.url) : [] };
  }

  /** Every comment of the issue with its replies, as events for those at or after `since`. */
  private async commentsOf(request: ReadRequest, ref: string, url: string): Promise<ActivityEvent[]> {
    const { http, signal } = request;
    const found = new Map<string, Comment>();
    const add = (comment: Comment) => found.set(comment.id, comment);
    let after: string | null = null;
    for (let pages = 0; ; pages += 1) {
      if (pages >= MAX_PAGES) throw new ReadProblem(`${ref}'s comments were cut off after ${pages} pages`);
      const { issue }: z.infer<typeof issueComments> = await send(http, signal, ISSUE_COMMENTS, { id: ref, after }, issueComments);
      for (const comment of issue.comments.nodes) {
        add(comment);
        for (const child of comment.children.nodes) add(child);
        let replies = comment.children.pageInfo;
        for (let more = 1; replies.hasNextPage; more += 1) {
          if (more >= MAX_PAGES || typeof replies.endCursor !== "string") throw new ReadProblem(`${ref}'s replies were cut off after ${more} pages`);
          const next = await send(http, signal, COMMENT_REPLIES, { id: comment.id, after: replies.endCursor }, commentReplies);
          for (const child of next.comment.children.nodes) add(child);
          replies = next.comment.children.pageInfo;
        }
      }
      const info: { hasNextPage: boolean; endCursor?: string | null | undefined } = issue.comments.pageInfo;
      if (!info.hasNextPage) break;
      if (typeof info.endCursor !== "string") throw new ReadProblem(`${ref}'s comments could not be paged`);
      after = info.endCursor;
    }
    return [...found.values()]
      .filter((comment) => atOrAfter(comment.createdAt, request.since))
      .map((comment) => ({
        id: `linear:comment:${comment.id}`,
        role: "tracker" as const,
        ref,
        url,
        kind: "commented" as const,
        actor: comment.user?.id ?? null,
        ...aliasesOf(comment.user),
        at: comment.createdAt,
        lastLine: lastLine(comment.body),
      }));
  }

  /** Lists the issues a filter selects. A listing that fails or is cut off becomes a failure with no ref and yields what it read before. */
  private async list(request: ReadRequest, filter: unknown, failures: ReadFailure[]): Promise<{ ref: string; url: string; at: string }[]> {
    const listed: { ref: string; url: string; at: string }[] = [];
    let after: string | null = null;
    try {
      for (let pages = 0; ; pages += 1) {
        if (pages >= MAX_PAGES) throw new ReadProblem(`A listing of issues was cut off after ${pages} pages`);
        const { issues }: z.infer<typeof issuesListed> = await send(request.http, request.signal, ISSUES_LISTED, { filter, after }, issuesListed);
        for (const node of issues.nodes) listed.push({ ref: node.identifier, url: node.url, at: node.updatedAt });
        if (!issues.pageInfo.hasNextPage) return listed;
        if (typeof issues.pageInfo.endCursor !== "string") throw new ReadProblem("A listing of issues could not be paged");
        after = issues.pageInfo.endCursor;
      }
    } catch (error) {
      if (isFatal(error) || request.signal.aborted) throw error;
      failures.push(failureOf(null, error, failureReason(error)));
      return listed;
    }
  }
}

/** The people filter that matches an operator by email or display name, and by account id where it looks like one. */
const operatorMatches = (operator: string) => [
  { email: { eqIgnoreCase: operator } },
  { displayName: { eqIgnoreCase: operator } },
  ...(UUID.test(operator) ? [{ id: { eq: operator.toLowerCase() } }] : []),
];

/**
 * Open issues of the team carrying the spec or ready label that are assigned to
 * the operator or filed by them and assigned to nobody. The read re-checks
 * the partition on each issue, so this only narrows the listing.
 */
const scanFilter = (team: string, labels: FleetLabels, operator: string) => ({
  and: [
    { team: { key: { eq: team } } },
    { state: { type: { nin: CLOSED_TYPES } } },
    { or: [{ labels: { name: { eqIgnoreCase: labels.spec } } }, { labels: { name: { eqIgnoreCase: labels.ready } } }] },
    { or: [{ assignee: { or: operatorMatches(operator) } }, { and: [{ assignee: { null: true } }, { creator: { or: operatorMatches(operator) } }] }] },
  ],
});

export const createLinearAdapter = (): ServiceAdapter => new LinearAdapter();
