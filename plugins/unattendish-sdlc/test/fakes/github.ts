// A fake GitHub REST API: an in-memory model of repositories (issues, pull
// requests, comments, review comments, reviews, issue events, check runs and
// commit statuses) answering exactly the endpoints the GitHub adapter reads,
// in the shapes docs.github.com documents, with `Link` pagination, `updated_at`
// filtering, and `ETag` with `304`. Its state is plain JSON, so the drive
// harness loads and reads it over `/__admin/state`. Written in erasable
// TypeScript only (no enums, namespaces or parameter properties), because the
// drive harness runs it with `node` directly.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FakeService } from "./listen";

export interface FakeIssue {
  number: number;
  state: "open" | "closed";
  labels: string[];
  /** Logins. */
  assignees: string[];
  /** The login that filed it. */
  creator: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present for a pull request. */
  pull?: { merged: boolean; headSha: string };
  /** Text a real service would carry and the adapter must never return. */
  title?: string;
  /** Field names left out of the answer, to script a response lacking one. */
  dropFields?: string[];
  /** Answer 404 for it, as for a deleted issue. */
  gone?: boolean;
  /** The repository (by `owner/repo`) and number it was transferred to: `GET` of it answers 301, as GitHub's "Get an issue" does. */
  transferredTo?: { repo: string; number: number };
}

export interface FakeComment {
  id: number;
  issue: number;
  user: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FakeReviewComment {
  id: number;
  pull: number;
  reviewId: number | null;
  user: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface FakeReview {
  id: number;
  pull: number;
  user: string | null;
  body: string | null;
  state: string;
  submittedAt: string | null;
}

export interface FakeEvent {
  id: number;
  issue: number;
  event: string;
  actor: string | null;
  createdAt: string;
  label?: string;
}

export interface FakeCheckRun {
  id: number;
  sha: string;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface FakeCommitStatus {
  sha: string;
  context: string;
  state: string;
}

export interface FakeRepo {
  /** The repository's numeric id, which a redirect names it by (`/repositories/{id}/...`) where given. */
  id?: number;
  issues: FakeIssue[];
  comments: FakeComment[];
  reviewComments: FakeReviewComment[];
  reviews: FakeReview[];
  events: FakeEvent[];
  checkRuns: FakeCheckRun[];
  statuses: FakeCommitStatus[];
}

/** An answer the fake gives instead of the real one for every request whose path (without query) contains `pathIncludes`. */
export interface FakeFault {
  pathIncludes: string;
  status: number;
  /** Header lines to send with it, such as `x-ratelimit-remaining: 0`. */
  headers?: Record<string, string>;
}

export interface FakeGithubState {
  /** Repositories by `owner/repo`. */
  repos: Record<string, FakeRepo>;
  faults: FakeFault[];
  /** Repository paths that have been renamed or transferred, by old `owner/repo` to the new one: any request under the old path answers 301. */
  renames: Record<string, string>;
  /** A full path (API root included) every `Link: rel="next"` points at instead of the request's own, to script a link that leaves the repository. */
  nextLinkPath?: string;
}

const emptyRepo = (): FakeRepo => ({ issues: [], comments: [], reviewComments: [], reviews: [], events: [], checkRuns: [], statuses: [] });

const normalise = (state: Partial<FakeGithubState> | undefined): FakeGithubState => {
  const repos: Record<string, FakeRepo> = {};
  for (const [name, repo] of Object.entries(state?.repos ?? {})) repos[name] = { ...emptyRepo(), ...repo };
  return { repos, faults: state?.faults ?? [], renames: state?.renames ?? {}, ...(state?.nextLinkPath === undefined ? {} : { nextLinkPath: state.nextLinkPath }) };
};

const send = (response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

const userOf = (login: string | null) => (login === null ? null : { login, id: login.length, type: "User" });

const byTime = (a: string, b: string): number => Date.parse(a) - Date.parse(b);

const pageOf = <T>(items: T[], query: URLSearchParams): { page: T[]; next: number | null } => {
  const perPage = Math.min(Number(query.get("per_page") ?? 30), 100);
  const page = Math.max(Number(query.get("page") ?? 1), 1);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  return { page: slice, next: page * perPage < items.length ? page + 1 : null };
};

export function createFakeGithub(initial?: Partial<FakeGithubState>): FakeService {
  let state = normalise(initial);

  const issueJson = (path: string, issue: FakeIssue, origin: string) => {
    const wire: Record<string, unknown> = {
      number: issue.number,
      title: issue.title ?? `Title of #${issue.number}`,
      state: issue.state,
      labels: issue.labels.map((name) => ({ name, color: "ededed" })),
      assignee: userOf(issue.assignees[0] ?? null),
      assignees: issue.assignees.map(userOf),
      user: userOf(issue.creator),
      html_url: `https://github.example/${path}/${issue.pull === undefined ? "issues" : "pull"}/${issue.number}`,
      created_at: issue.createdAt,
      updated_at: issue.updatedAt,
    };
    if (issue.pull !== undefined) {
      wire.pull_request = {
        url: `${origin}/repos/${path}/pulls/${issue.number}`,
        html_url: wire.html_url,
        merged_at: issue.pull.merged ? issue.updatedAt : null,
      };
    }
    for (const name of issue.dropFields ?? []) delete wire[name];
    return wire;
  };

  const pullJson = (path: string, issue: FakeIssue) => ({
    number: issue.number,
    state: issue.state,
    merged: issue.pull?.merged ?? false,
    merged_at: issue.pull?.merged === true ? issue.updatedAt : null,
    html_url: `https://github.example/${path}/pull/${issue.number}`,
    head: { sha: issue.pull?.headSha ?? "", ref: `branch-${issue.number}` },
    user: userOf(issue.creator),
    labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map(userOf),
  });

  /** Sends `items` as the page asked for, with a `Link: rel="next"` where more remain; `wrap` puts them inside an object, as GitHub does for check runs and statuses. */
  const sendPage = <T>(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    items: T[],
    wrap?: (page: T[], total: number) => unknown,
  ): void => {
    const { page, next } = pageOf(items, url.searchParams);
    const headers: Record<string, string> = {};
    if (next !== null) {
      const link = new URL(`http://${request.headers.host ?? "127.0.0.1"}${state.nextLinkPath ?? url.pathname}`);
      for (const [name, value] of url.searchParams) link.searchParams.set(name, value);
      link.searchParams.set("page", String(next));
      headers.link = `<${link.toString()}>; rel="next"`;
    }
    const body = wrap === undefined ? page : wrap(page, items.length);
    send(response, body, 200, withEtag(body, headers));
  };

  const withEtag = (body: unknown, headers: Record<string, string>): Record<string, string> => ({
    ...headers,
    etag: `"${createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`,
  });

  const route = (request: IncomingMessage, response: ServerResponse): boolean => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const byId = url.pathname.indexOf("/repositories/");
    const split = byId >= 0 ? byId : url.pathname.indexOf("/repos/");
    if (split < 0) return false;
    const origin = `http://${host}${url.pathname.slice(0, split)}`;
    const rest = url.pathname.slice(split + (byId >= 0 ? "/repositories/" : "/repos/").length).split("/");
    // `/repositories/{id}/...` names the repository by its id; it is served as the same repository's `/repos/` path.
    const path = byId >= 0 ? (Object.entries(state.repos).find(([, candidate]) => String(candidate.id) === rest[0])?.[0] ?? `${rest[0]}`) : `${rest[0]}/${rest[1]}`;
    const tail = rest.slice(byId >= 0 ? 1 : 2);
    // GitHub names a repository without regard to case.
    const repo = Object.entries(state.repos).find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
    const location = (target: string, tailPath: string): string => {
      const targetId = state.repos[target]?.id;
      return `${origin}${targetId === undefined ? `/repos/${target}` : `/repositories/${targetId}`}${tailPath}${url.search}`;
    };
    const renamed = byId >= 0 ? undefined : Object.entries(state.renames).find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
    if (renamed !== undefined) {
      send(response, { message: "Moved Permanently" }, 301, { location: location(renamed, `/${tail.join("/")}`) });
      return true;
    }

    for (const fault of state.faults) {
      if (url.pathname.includes(fault.pathIncludes)) {
        send(response, { message: "scripted failure" }, fault.status, fault.headers ?? {});
        return true;
      }
    }
    if (request.method !== "GET") {
      send(response, { message: "Method Not Allowed" }, 405);
      return true;
    }
    if (repo === undefined) return false;

    const respondConditional = (body: unknown): void => {
      const headers = withEtag(body, {});
      if (request.headers["if-none-match"] === headers.etag) {
        response.writeHead(304, { etag: headers.etag });
        response.end();
        return;
      }
      send(response, body, 200, headers);
    };

    const issue = (numberText: string | undefined): FakeIssue | undefined => {
      const found = repo.issues.find((candidate) => String(candidate.number) === numberText);
      return found === undefined || found.gone === true ? undefined : found;
    };
    const since = url.searchParams.get("since");
    const updatedSince = (time: string): boolean => since === null || Date.parse(time) >= Date.parse(since);
    const pageConditional = <T>(items: T[], wrap?: (page: T[], total: number) => unknown): void => {
      const { page } = pageOf(items, url.searchParams);
      const etag = withEtag(wrap === undefined ? page : wrap(page, items.length), {}).etag;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag });
        response.end();
        return;
      }
      sendPage(request, response, url, items, wrap);
    };

    if (tail[0] === "issues" && tail.length === 1) {
      const query = url.searchParams;
      const state_ = query.get("state") ?? "open";
      const labels = (query.get("labels") ?? "").split(",").filter((name) => name !== "");
      const assignee = query.get("assignee");
      const creator = query.get("creator");
      let found = repo.issues.filter((candidate) => candidate.gone !== true);
      found = found.filter((candidate) => state_ === "all" || candidate.state === state_);
      found = found.filter((candidate) => updatedSince(candidate.updatedAt));
      found = found.filter((candidate) => labels.every((name) => candidate.labels.some((own) => own.toLowerCase() === name.toLowerCase())));
      if (assignee === "none") found = found.filter((candidate) => candidate.assignees.length === 0);
      else if (assignee === "*") found = found.filter((candidate) => candidate.assignees.length > 0);
      else if (assignee !== null) found = found.filter((candidate) => candidate.assignees.includes(assignee));
      if (creator !== null) found = found.filter((candidate) => candidate.creator === creator);
      const field = query.get("sort") === "updated" ? "updatedAt" : "createdAt";
      const direction = query.get("direction") === "asc" ? 1 : -1;
      found.sort((a, b) => direction * byTime(a[field], b[field]));
      pageConditional(found.map((candidate) => issueJson(path, candidate, origin)));
      return true;
    }
    if (tail[0] === "issues" && tail.length === 2) {
      const transferred = repo.issues.find((candidate) => String(candidate.number) === tail[1])?.transferredTo;
      if (transferred !== undefined) {
        send(response, { message: "Moved Permanently" }, 301, { location: location(transferred.repo, `/issues/${transferred.number}`) });
        return true;
      }
      const found = issue(tail[1]);
      if (found === undefined) send(response, { message: "Not Found" }, 404);
      else respondConditional(issueJson(path, found, origin));
      return true;
    }
    if (tail[0] === "issues" && tail[2] === "comments" && tail.length === 3) {
      if (issue(tail[1]) === undefined) return send404(response);
      const found = repo.comments
        .filter((comment) => String(comment.issue) === tail[1] && updatedSince(comment.updatedAt))
        .sort((a, b) => byTime(a.createdAt, b.createdAt) || a.id - b.id);
      pageConditional(
        found.map((comment) => ({
          id: comment.id,
          body: comment.body,
          user: userOf(comment.user),
          created_at: comment.createdAt,
          updated_at: comment.updatedAt,
          html_url: `https://github.example/${path}/issues/${comment.issue}#issuecomment-${comment.id}`,
          issue_url: `${origin}/repos/${path}/issues/${comment.issue}`,
        })),
      );
      return true;
    }
    if (tail[0] === "issues" && tail[2] === "events" && tail.length === 3) {
      if (issue(tail[1]) === undefined) return send404(response);
      const found = repo.events.filter((event) => String(event.issue) === tail[1]).sort((a, b) => a.id - b.id);
      pageConditional(
        found.map((event) => ({
          id: event.id,
          event: event.event,
          actor: userOf(event.actor),
          created_at: event.createdAt,
          commit_id: null,
          ...(event.label === undefined ? {} : { label: { name: event.label, color: "ededed" } }),
        })),
      );
      return true;
    }
    if (tail[0] === "pulls" && tail.length === 2) {
      const found = issue(tail[1]);
      if (found === undefined || found.pull === undefined) send(response, { message: "Not Found" }, 404);
      else respondConditional(pullJson(path, found));
      return true;
    }
    if (tail[0] === "pulls" && tail[2] === "comments" && tail.length === 3) {
      const found = issue(tail[1]);
      if (found === undefined || found.pull === undefined) return send404(response);
      const comments = repo.reviewComments
        .filter((comment) => String(comment.pull) === tail[1] && updatedSince(comment.updatedAt))
        .sort((a, b) => byTime(a.createdAt, b.createdAt) || a.id - b.id);
      pageConditional(
        comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          user: userOf(comment.user),
          created_at: comment.createdAt,
          updated_at: comment.updatedAt,
          pull_request_review_id: comment.reviewId,
          pull_request_url: `${origin}/repos/${path}/pulls/${comment.pull}`,
          html_url: `https://github.example/${path}/pull/${comment.pull}#discussion_r${comment.id}`,
        })),
      );
      return true;
    }
    if (tail[0] === "pulls" && tail[2] === "reviews" && tail.length === 3) {
      const found = issue(tail[1]);
      if (found === undefined || found.pull === undefined) return send404(response);
      const reviews = repo.reviews.filter((review) => String(review.pull) === tail[1]).sort((a, b) => a.id - b.id);
      pageConditional(
        reviews.map((review) => ({
          id: review.id,
          user: userOf(review.user),
          body: review.body,
          state: review.state,
          // A pending review has no submitted_at.
          ...(review.submittedAt === null ? {} : { submitted_at: review.submittedAt }),
          html_url: `https://github.example/${path}/pull/${review.pull}#pullrequestreview-${review.id}`,
          commit_id: null,
        })),
      );
      return true;
    }
    if (tail[0] === "commits" && tail[2] === "check-runs" && tail.length === 3) {
      // `filter` is `latest` (the default: the most recent run of each check name) or `all` (every run, re-runs included).
      const filter = url.searchParams.get("filter") ?? "latest";
      if (filter !== "latest" && filter !== "all") {
        send(response, { message: "Validation Failed" }, 422);
        return true;
      }
      const onCommit = repo.checkRuns.filter((run) => run.sha === tail[1]);
      const runs = (filter === "all" ? onCommit : onCommit.filter((run) => !onCommit.some((other) => other.name === run.name && other.id > run.id))).sort((a, b) => a.id - b.id);
      pageConditional(
        runs.map((run) => ({ id: run.id, name: run.name, head_sha: run.sha, status: run.status, conclusion: run.conclusion })),
        (page, total) => ({ total_count: total, check_runs: page }),
      );
      return true;
    }
    if (tail[0] === "commits" && tail[2] === "status" && tail.length === 3) {
      const statuses = repo.statuses.filter((status) => status.sha === tail[1]);
      pageConditional(
        statuses.map((status, index) => ({ id: index + 1, context: status.context, state: status.state })),
        (page, total) => ({
          sha: tail[1],
          total_count: total,
          // GitHub computes the combined state over the latest status of each context.
          state: statuses.some((s) => s.state === "failure" || s.state === "error") ? "failure" : statuses.length === 0 || statuses.some((s) => s.state === "pending") ? "pending" : "success",
          statuses: page,
        }),
      );
      return true;
    }
    return false;
  };

  const send404 = (response: ServerResponse): boolean => {
    send(response, { message: "Not Found" }, 404);
    return true;
  };

  return {
    handle: (request, _body, response) => route(request, response),
    setState: (next) => {
      state = normalise(next as Partial<FakeGithubState>);
    },
    getState: () => state,
  };
}
