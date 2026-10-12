// The GitHub service adapter (github.com and GitHub Enterprise Server): it
// reads a fleet's repository through the REST API and normalises what it
// finds. It decides nothing about waking, and sends only GETs.
//
// What each request rests on, from docs.github.com (read 2026-10-12):
//  - Issues and pull requests: /en/rest/issues/issues, /en/rest/pulls/pulls.
//    The issue list takes `state` (default `open`), `since` (last updated after,
//    `YYYY-MM-DDTHH:MM:SSZ`), `labels` (comma separated), `assignee` (`none`, `*`
//    or a login), `creator`, `sort`, `direction`, `per_page` (max 100). It lists
//    pull requests too, told apart by their `pull_request` key; so does
//    GET /issues/{n}. `merged` comes from GET /pulls/{n}.
//  - Comments: /en/rest/issues/comments, /en/rest/pulls/comments take `since`
//    (last updated after). /en/rest/pulls/reviews takes none, so reviews are
//    filtered here by `submitted_at`; a pending review has no `submitted_at`.
//  - Timeline: /en/rest/issues/events and /en/rest/using-the-rest-api/issue-event-types
//    give `closed`, `reopened`, `merged`, `labeled`, `unlabeled`, each with `actor`
//    and `created_at`, and `label.name` for the last two. The endpoint takes no
//    `since`, so it is read whole (up to 10 pages of 100) and filtered here.
//  - Pagination and conditional requests: /en/rest/using-the-rest-api/using-pagination-in-the-rest-api
//    and .../best-practices-for-using-the-rest-api (a 304 does not use the rate
//    limit, which the HTTP session accounts for). Enterprise Server's REST root
//    is `http(s)://HOSTNAME/api/v3` (/en/enterprise-server@latest/rest/using-the-rest-api/getting-started-with-the-rest-api).
//
// Moved items: "Get an issue" (/en/rest/issues/issues) says the API "returns a 301
// Moved Permanently status if the issue was transferred to another repository",
// and /en/rest/repos/repos lists a 301 for a repository without saying when;
// /en/rest/using-the-rest-api/best-practices-for-using-the-rest-api says to
// follow a 301 to its `location`. The docs give no Location form (the
// `/repositories/{id}/...` path is not documented for it), so every request is
// made with `stayUnder` `/repos/{owner}/{repo}/`: a redirect that leaves it,
// whatever it looks like, is a failure of kind `outside-fleet`, never read.
//
// Next links: /en/rest/using-the-rest-api/using-pagination-in-the-rest-api shows
// them as `https://api.github.com/repositories/1300192/issues?per_page=2&page=2`
// for a request made under `/repos/{owner}/{repo}/`, and the repository's `id`
// ("Get a repository", /en/rest/repos/repos) is an integer. The docs state no
// rule, so the HTTP layer takes a next link under the repository's path or under
// `/repositories/{digits}/` after the credential's base path (Enterprise Server's
// pagination examples show no `/api/v3`; the base path is kept for them), and
// any other next link is `outside-fleet`. The docs do not say whether the id in
// the link is the repository's own, so it is not compared with anything.
//
// A 403 that is not a rate limit is the HTTP layer's `forbidden`: it fails that one item or
// listing, and the read goes on. Only a 401 or a rate limit ends the read.
//
// What the docs leave unconfirmed, and the cheapest fallback taken:
//  - The values of a review's `state`: only `APPROVED`, `CHANGES_REQUESTED` and
//    `COMMENTED` are events; any other state (`PENDING`, `DISMISSED`) is not.
//  - The order of issue events: they are sorted here by time and id.
//  - Whether a merged pull request reports a `closed` event beside `merged`: the
//    timeline is passed on as GitHub gives it.
//  - What `sort=updated` sorts on, and whether `since` includes its own instant:
//    /en/rest/issues/issues lists `sort` as created|updated|comments and `direction` as asc|desc,
//    and `since` as "last updated after" a time, naming neither `updated_at` nor
//    the boundary. The updated listing is taken to run oldest `updated_at` first, and
//    one cut off at its page limit reports its last `updated_at` less one second.
//  - Whether a review or a label change moves `updated_at`: watched
//    items are read themselves, and the updated listing is only a hint.
//  - Whether submitting a review moves the `updated_at` of its inline comments,
//    which is what `since` filters them on: they are read without `since`, up to
//    10 pages of 100, and a review comment counts at its review's `submitted_at`.
//  - Whether the issue schema's `labels` are objects or names: both are read.
import {
  type HttpResponse,
  type HttpSession,
  type ReadRequest,
  type ServiceAdapter,
} from "../application/ports";
import type {
  ActivityEvent,
  ActivityKind,
  ItemSnapshot,
  ReadFailure,
  ReadOutcome,
  SourceRole,
  Transition,
  UpdatedItem,
  WatchedItem,
} from "../domain/model";
import { lastLine } from "../domain/text";
import {
  assigneesOf,
  commentShape,
  eventKindShape,
  eventShape,
  iso,
  issueShape,
  labelName,
  listedShape,
  numberOf,
  parse,
  pullShape,
  reviewCommentShape,
  reviewShape,
  type IssueWire,
} from "./github-wire";
import { forgeFailure } from "./forge-failure";
import { isFatal, ReadProblem } from "./service-support";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const REVIEW_KINDS: Readonly<Record<string, ActivityKind>> = {
  APPROVED: "reviewed: approved",
  CHANGES_REQUESTED: "reviewed: changes requested",
  COMMENTED: "reviewed: commented",
};

type Query = Readonly<Record<string, string | number | undefined>>;

/** What reading one repository needs, bound once per `read`. */
interface Reading {
  readonly request: ReadRequest;
  readonly http: HttpSession;
  /** `/repos/owner/repo`. */
  readonly repo: string;
  /** The prefix every request, redirect and next link must stay under: a moved or renamed repository answers elsewhere. */
  readonly stayUnder: string;
  readonly sinceMs: number;
  /** The four registered labels by lower-cased spelling. */
  readonly fleetLabels: ReadonlyMap<string, string>;
}

/** The part of an item that reading it by number yields. */
interface ItemRead {
  readonly snapshot: ItemSnapshot;
  readonly events: ActivityEvent[];
}

const repoPath = (path: string): string | null => {
  const parts = path.split("/");
  return parts.length === 2 && parts.every((part) => part !== "") ? `/repos/${parts.map(encodeURIComponent).join("/")}` : null;
};

const sinceParam = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

class GithubAdapter implements ServiceAdapter {
  readonly service = "github" as const;

  async read(request: ReadRequest): Promise<ReadOutcome> {
    const snapshots: ItemSnapshot[] = [];
    const events: ActivityEvent[] = [];
    const updated: UpdatedItem[] = [];
    const failures: ReadFailure[] = [];
    let listingCutAt: string | undefined;
    const outcome = (): ReadOutcome => ({ snapshots, events, updated, failures, ...(listingCutAt === undefined ? {} : { listingCutAt }) });

    const repo = request.source.role === "forge" && request.source.service === "github" ? repoPath(request.source.path) : null;
    const sinceMs = Date.parse(request.since);
    if (repo === null || Number.isNaN(sinceMs)) {
      failures.push({ ref: null, reason: repo === null ? "the source is not a GitHub repository path" : "the cursor's time is not a time" });
      return outcome();
    }
    const reading: Reading = {
      request,
      http: request.http,
      repo,
      stayUnder: `${repo}/`,
      sinceMs,
      fleetLabels: new Map(
        [request.labels.spec, request.labels.ready, request.labels.inProgress, request.labels.needsInput].map((name) => [name.toLowerCase(), name]),
      ),
    };

    const seen = new Set<string>();
    for (const item of request.items) {
      if (seen.has(item.ref)) continue;
      seen.add(item.ref);
      try {
        const read = await this.readItem(reading, item);
        snapshots.push(read.snapshot);
        events.push(...read.events);
      } catch (error) {
        if (isFatal(error)) throw error;
        failures.push(forgeFailure(item.ref, error));
      }
    }

    if (request.stateOnly) return outcome();

    if (request.scanPartition) await this.scanPartition(reading, seen, snapshots, failures);
    listingCutAt = await this.listUpdated(reading, updated, failures);
    return outcome();
  }

  // ---- one item ----

  private async readItem(reading: Reading, item: WatchedItem): Promise<ItemRead> {
    const number = numberOf(item.ref);
    if (number === null) throw new ReadProblem("the reference is not a GitHub issue or pull request number");
    const response = await this.get(reading, `${reading.repo}/issues/${number}`);
    const issue = parse(`issue ${item.ref}`, issueShape, response.json);
    return this.describe(reading, item.role, item.ref, issue, reading.request.watchedRefs.has(item.ref) && !reading.request.stateOnly);
  }

  /** Turns an issue as GitHub gave it into a snapshot, reading the pull request and timeline around it, and its comments and reviews where `withActivity`. */
  private async describe(reading: Reading, role: SourceRole, ref: string, issue: IssueWire, withActivity: boolean): Promise<ItemRead> {
    const number = issue.number;
    const pull =
      issue.pull_request === undefined
        ? null
        : parse(`pull request ${ref}`, pullShape, (await this.get(reading, `${reading.repo}/pulls/${number}`)).json);

    const lowerLabels = new Set(issue.labels.map((entry) => labelName(entry).toLowerCase()));
    const fleetLabels = [...reading.fleetLabels].filter(([lower]) => lowerLabels.has(lower)).map(([, registered]) => registered);
    const operator = reading.request.operator.toLowerCase();
    const assignees = assigneesOf(issue).map((login) => login.toLowerCase());
    const inPartition = assignees.includes(operator) || (assignees.length === 0 && issue.user?.login.toLowerCase() === operator);

    const url = pull === null ? issue.html_url : pull.html_url;
    const transitions = await this.transitions(reading, number);
    const snapshot: ItemSnapshot = {
      role,
      ref,
      url,
      open: issue.state === "open" && !(pull?.merged ?? false),
      merged: pull?.merged ?? false,
      fleetLabels,
      inPartition,
      transitions,
    };
    const events = withActivity ? await this.activity(reading, role, ref, url, number, pull !== null) : [];
    return { snapshot, events };
  }

  // ---- timeline ----

  private async transitions(reading: Reading, number: number): Promise<Transition[]> {
    const raw = await this.list(reading, `${reading.repo}/issues/${number}/events`, {}, `the timeline of #${number}`);
    const found: Transition[] = [];
    for (const entry of raw) {
      const { event: kind } = parse("an issue event", eventKindShape, entry);
      const transition = TRANSITION_KINDS[kind];
      if (transition === undefined) continue;
      const event = parse(`a ${kind} event`, eventShape, entry);
      if (Date.parse(event.created_at) < reading.sinceMs) continue;
      const base = { actor: event.actor?.login ?? null, at: iso(event.created_at), id: `github:event:${event.id}` };
      if (transition === "labelled" || transition === "unlabelled") {
        if (event.label === null || event.label === undefined) throw new ReadProblem(`a ${kind} event lacked label`);
        const registered = reading.fleetLabels.get(event.label.name.toLowerCase());
        if (registered === undefined) continue;
        found.push({ kind: transition, label: registered, ...base });
      } else {
        found.push({ kind: transition, ...base });
      }
    }
    return found.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id, "en", { numeric: true }));
  }

  // ---- comments and reviews ----

  private async activity(reading: Reading, role: SourceRole, ref: string, url: string, number: number, isPull: boolean): Promise<ActivityEvent[]> {
    const query = { since: sinceParam(reading.sinceMs) };
    const found: ActivityEvent[] = [];
    const push = (id: string, kind: ActivityKind, actor: string | null | undefined, at: string, body: string | null | undefined): void => {
      found.push({ id, role, ref, url, kind, actor: actor ?? null, at: iso(at), lastLine: lastLine(body) });
    };

    for (const entry of await this.list(reading, `${reading.repo}/issues/${number}/comments`, query, `the comments of ${ref}`)) {
      const comment = parse("a comment", commentShape, entry);
      if (Date.parse(comment.created_at) >= reading.sinceMs) push(`github:issuecomment:${comment.id}`, "commented", comment.user?.login, comment.created_at, comment.body);
    }

    if (isPull) {
      const reviews = (await this.list(reading, `${reading.repo}/pulls/${number}/reviews`, {}, `the reviews of ${ref}`)).map((entry) => parse("a review", reviewShape, entry));
      // A review's inline comments arrive when it is submitted, whenever they were drafted; those of a review still pending do not arrive yet.
      const submitted = new Map<number, string>();
      const pending = new Set<number>();
      for (const review of reviews) {
        if (review.state.toUpperCase() === "PENDING") pending.add(review.id);
        else if (review.submitted_at !== null && review.submitted_at !== undefined) submitted.set(review.id, review.submitted_at);
      }
      for (const review of reviews) {
        const kind = REVIEW_KINDS[review.state.toUpperCase()];
        if (kind === undefined) continue;
        if (review.submitted_at === null || review.submitted_at === undefined) throw new ReadProblem("a submitted review lacked submitted_at");
        if (Date.parse(review.submitted_at) >= reading.sinceMs) push(`github:review:${review.id}`, kind, review.user?.login, review.submitted_at, review.body);
      }
      for (const entry of await this.list(reading, `${reading.repo}/pulls/${number}/comments`, {}, `the review comments of ${ref}`)) {
        const comment = parse("a review comment", reviewCommentShape, entry);
        const reviewId = comment.pull_request_review_id ?? null;
        if (reviewId !== null && pending.has(reviewId)) continue;
        const at = reviewId === null ? comment.created_at : (submitted.get(reviewId) ?? comment.created_at);
        if (Date.parse(at) >= reading.sinceMs) push(`github:reviewcomment:${comment.id}`, "commented", comment.user?.login, at, comment.body);
      }
    }
    return found.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id, "en", { numeric: true }));
  }

  // ---- listings ----

  /** Items carrying the spec or ready label that are the operator's, open, and not yet read. */
  private async scanPartition(reading: Reading, seen: Set<string>, snapshots: ItemSnapshot[], failures: ReadFailure[]): Promise<void> {
    const { operator, labels } = reading.request;
    const queries: Query[] = [];
    for (const label of [labels.spec, labels.ready]) {
      queries.push({ state: "open", labels: label, assignee: operator });
      queries.push({ state: "open", labels: label, creator: operator, assignee: "none" });
    }
    for (const query of queries) {
      let listed: unknown[];
      try {
        listed = await this.list(reading, `${reading.repo}/issues`, query, "the partition listing");
      } catch (error) {
        if (isFatal(error)) throw error;
        failures.push(forgeFailure(null, error));
        continue;
      }
      for (const entry of listed) {
        const ref = refOfListed(entry);
        if (ref !== null && seen.has(ref)) continue;
        try {
          const issue = parse("a listed issue", issueShape, entry);
          const read = await this.describe(reading, reading.request.source.role, `#${issue.number}`, issue, false);
          seen.add(read.snapshot.ref);
          snapshots.push(read.snapshot);
        } catch (error) {
          if (isFatal(error)) throw error;
          failures.push(forgeFailure(ref, error));
        }
      }
    }
  }

  /**
   * Lists the issues updated since the cursor, oldest first. A listing cut off at its page limit returns the `updated_at`
   * of the last issue it listed, less one second because the docs do not say whether `since` includes its own instant;
   * everything older was listed. The cut-off is no failure unless that time is not after the cursor, when the listing
   * could not move it.
   */
  private async listUpdated(reading: Reading, updated: UpdatedItem[], failures: ReadFailure[]): Promise<string | undefined> {
    let listed: unknown[];
    let truncated: boolean;
    try {
      ({ items: listed, truncated } = await reading.http.paginate(
        { path: `${reading.repo}/issues`, query: { state: "all", since: sinceParam(reading.sinceMs), sort: "updated", direction: "asc", per_page: PAGE_SIZE }, stayUnder: reading.stayUnder },
        { maxPages: MAX_PAGES, signal: reading.request.signal },
      ));
    } catch (error) {
      if (isFatal(error)) throw error;
      failures.push(forgeFailure(null, error));
      return undefined;
    }
    let last: string | null = null;
    for (const entry of listed) {
      try {
        const item = parse("a listed issue", listedShape, entry);
        updated.push({ role: reading.request.source.role, ref: `#${item.number}`, url: item.html_url, at: iso(item.updated_at) });
        last = iso(item.updated_at);
      } catch (error) {
        failures.push(forgeFailure(refOfListed(entry), error));
      }
    }
    if (!truncated) return undefined;
    const cut = last === null ? null : Date.parse(last) - 1000;
    if (cut !== null && cut > reading.sinceMs) return new Date(cut).toISOString();
    failures.push({ ref: null, reason: `the updated listing was longer than ${MAX_PAGES} pages` });
    return undefined;
  }

  // ---- requests ----

  private get(reading: Reading, path: string, query?: Query): Promise<HttpResponse> {
    return reading.http.request({ method: "GET", path, stayUnder: reading.stayUnder, ...(query === undefined ? {} : { query }) }, { signal: reading.request.signal });
  }

  /** Every entry of a list, page after page; a list longer than 10 pages is an error naming `what`. */
  private async list(reading: Reading, path: string, query: Query, what: string): Promise<unknown[]> {
    const { items, truncated } = await reading.http.paginate({ path, query: { ...query, per_page: PAGE_SIZE }, stayUnder: reading.stayUnder }, { maxPages: MAX_PAGES, signal: reading.request.signal });
    if (truncated) throw new ReadProblem(`${what} was longer than ${MAX_PAGES} pages`);
    return items;
  }
}

const TRANSITION_KINDS: Readonly<Record<string, Transition["kind"] | undefined>> = {
  closed: "closed",
  reopened: "reopened",
  merged: "merged",
  labeled: "labelled",
  unlabeled: "unlabelled",
};

/** The `#n` of a listed entry, where it has a number at all. */
const refOfListed = (entry: unknown): string | null => {
  const number = (entry as { number?: unknown } | null)?.number;
  return typeof number === "number" && Number.isInteger(number) ? `#${number}` : null;
};

export const createGithubAdapter = (): ServiceAdapter => new GithubAdapter();
