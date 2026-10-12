// The GitLab adapter: reads a project's issues and merge requests on
// gitlab.com or a self-managed instance, and says what it found in the
// Fleet's words. It decides nothing about waking.
//
// What each read rests on (docs.gitlab.com, REST API v4, read 2026-10-12):
// - Issues and merge requests, their lists and filters (`updated_after`,
//   `state`, `labels` as a comma-separated AND, `assignee_username`,
//   `author_username`, `assignee_id=None`, `order_by`, `sort`) and fields
//   (`iid`, `state`, `labels`, `assignees`, `author.username`, `web_url`,
//   `merged_at`, `sha`, `head_pipeline` in the single answer): /api/issues/
//   and /api/merge_requests/. The project is `:id`, URL-encoded.
// - Order of the updated listing: `order_by` takes `updated_at` and `sort` takes `asc` or `desc` on both lists, and
//   `updated_after` is "updated on or after" a time (/api/issues/, /api/merge_requests/). The listing runs
//   `updated_at` ascending, so one cut off at its page limit reports the last `updated_at` it read as where the
//   cursor may move. The docs do not say that offset pagination keeps a stable order under `updated_at`; under
//   `asc`, an item updated while the pages are read moves to the end of the list and every later entry shifts one
//   place earlier, so the entry at a page boundary can be skipped (never repeated, as under `desc`). The listing
//   feeds only the ledger's out-of-scope rows, so a missed row is the cost; watched items are read one by one.
// - Pagination (`Link` rel="next", `X-Next-Page`, `per_page` at most 100):
//   /api/rest/.
// - Comments: the notes list gives an issue's comments, with `system` true for
//   GitLab's own notes, and has no time filter (/api/notes/). It says a merge
//   request's notes are not attached to lines, and its discussions list
//   (`DiscussionNote`, `DiffNote`) is where inline comments are given
//   (/api/discussions/), so a merge request's comments are read from there.
// - Approvals: `GET .../approvals` gives `approved_by[].user` and
//   `approved_at` on every tier (/api/merge_request_approvals/).
// - Transitions: resource label events (`label.name`, `action` add or remove,
//   `user.username`, `created_at`, `id`) and resource state events (`state`,
//   `user`, `created_at`, `id`): /api/resource_label_events/ and
//   /api/resource_state_events/. Neither page states an order or a time filter.
// - Checks: the merge request's `head_pipeline` ("Pipeline that runs on the HEAD
//   commit of the merge request's source branch"; `id`, `sha`, `status`), alone:
//   an older or since-rerun pipeline is not part of the set. Its `sha` is not
//   compared with the merge request's, as the docs do not say a merged-results
//   pipeline has the head commit's. Where the answer has none (it is exposed only
//   to a user who can view pipelines), the newest pipeline, by `id`, of
//   `GET .../merge_requests/:iid/pipelines` on the head commit stands in; that
//   page gives no order. Status values: "List project pipelines" in /api/pipelines/.
// - Token expiry: `GET /personal_access_tokens/self`, `expires_at` as
//   `YYYY-MM-DD` or null (/api/personal_access_tokens/).
//
// Moved items (docs.gitlab.com, read 2026-10-12): moving an issue "closes and copies
// it to the target project" and "the original issue is not deleted"
// (/user/project/issues/managing_issues/), so the old iid is read where it is,
// closed. A renamed or transferred project's old path "is redirected to the new
// one" and "API redirects might need to be followed explicitly"
// (/user/project/working_with_projects/, /user/project/repository/, "Repository
// path changes"); the status code is not given. Every request of the project is
// made with `stayUnder` `/projects/:id/` (the id as read, URL-encoded), so a
// redirect or next link to any other path is a failure of kind `outside-fleet`.
//
// A 403 that is not a rate limit is the HTTP layer's `forbidden`: on the
// pipelines or the reviewers of a merge request it leaves `checks` or `reviewers`
// out and the rest of the item is still read; anywhere else it fails that one
// item or listing. Only a 401 or a rate limit ends the read.
//
// Not confirmed by those pages, and what is done instead:
// - Reviewers: "Retrieve merge request reviewers" (/api/merge_requests/,
//   `GET .../merge_requests/:iid/reviewers`) lists each reviewer's `user`, `state`
//   and `created_at`. Its example shows only `unreviewed` and `reviewed`, and the
//   page lists no states, gives no version and does not say what `created_at`
//   dates. The webhook payloads page (/user/project/integrations/webhook_events/)
//   lists a reviewer's `state` as `unreviewed`, `review_started`, `reviewed`,
//   `requested_changes`, `approved` or `unapproved`, and GitLab's source
//   (gitlab-org/gitlab, `lib/api/entities/merge_request_reviewer.rb`, which
//   exposes `state` as it is, and `app/models/concerns/merge_request_reviewer_state.rb`,
//   which defines those six) shows the REST endpoint gives the same values.
//   "Request changes" arrived behind a flag in GitLab 16.11, is on by default in
//   17.2 and has no flag from 17.3 (/user/project/merge_requests/reviews/); on an
//   older instance no reviewer is ever `requested_changes`. A state has no time or
//   id, so a merge request's snapshot carries the states as they are now
//   (`reviewers`): `requested_changes` is `changes requested` and `reviewed` is
//   `commented`; `approved` is left to the approvals list, so it is not reported
//   twice. An instance or token that cannot list reviewers (404, 403) leaves the
//   merge request read without them. No system note is read: the text of the
//   notes for an approval or a request for changes is not documented.
// - A state event's `merged` value is not documented. It is used when sent;
//   otherwise a merged request's `merged_at` gives the `merged` transition.
// - ETag and 304 are not documented for the REST API. The session sends a
//   conditional request whenever GitLab has sent an ETag.
// - Whether `labels` matches without regard to case is not documented, so the
//   partition scan lists with each label as registered; an item's own labels
//   are compared without regard to case.
// - The notes list can be sorted newest first, but the discussions and event
//   lists state no order, so every list is read in full (10 pages of 100).
import { HttpError, type HttpSession, type ReadRequest, type ServiceAdapter } from "../application/ports";
import type { ActivityEvent, ItemSnapshot, ReadFailure, ReadOutcome, SourceRole, Transition, UpdatedItem, WatchedItem } from "../domain/model";
import { lastLine } from "../domain/text";
import {
  approvalsSchema,
  atOrAfter,
  byTimeThenId,
  checksOutcome,
  discussionSchema,
  expiryIso,
  fleetLabelsOf,
  inPartition,
  issueSchema,
  labelTransitions,
  listedSchema,
  mergedFromFields,
  mergeRequestSchema,
  parse,
  pipelinesSchema,
  reviewerStates,
  reviewersSchema,
  stateTransitions,
  tokenSchema,
  userNote,
} from "./gitlab-normalise";
import { forgeFailure } from "./forge-failure";
import { isFatal, ReadProblem } from "./service-support";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface Context {
  readonly request: ReadRequest;
  readonly http: HttpSession;
  /** The project's `:id`, URL-encoded. */
  readonly project: string;
  /** The prefix every project request, redirect and next link must stay under: a renamed or transferred project answers elsewhere. */
  readonly stayUnder: string;
  readonly failures: ReadFailure[];
}

type Target = { readonly kind: "issues" | "merge_requests"; readonly iid: number };

const parseRef = (ref: string): Target => {
  const match = /^([#!])(\d+)$/.exec(ref);
  if (match === null) throw new ReadProblem("the reference is neither #<iid> nor !<iid>");
  return { kind: match[1] === "#" ? "issues" : "merge_requests", iid: Number(match[2]) };
};

const refOf = (kind: Target["kind"], iid: number): string => `${kind === "issues" ? "#" : "!"}${iid}`;

/** Runs a read; a failure of it becomes a `ReadFailure` for `ref`, except a refused credential and a rate limit, which end the whole read. */
async function guarded<T>(context: Context, ref: string | null, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (isFatal(error)) throw error;
    if (error instanceof HttpError || error instanceof ReadProblem) {
      context.failures.push(forgeFailure(ref, error));
      return undefined;
    }
    throw error;
  }
}

const get = async (context: Context, path: string, query?: Record<string, string | number | undefined>): Promise<unknown> =>
  (await context.http.request({ method: "GET", path, query, stayUnder: context.stayUnder }, { signal: context.request.signal })).json;

/** The entries of a list read in pages of 100, up to 10 pages, and whether more were left. */
const listPages = (context: Context, path: string, query: Record<string, string | number | undefined>) =>
  context.http.paginate({ path, query: { ...query, per_page: PAGE_SIZE }, stayUnder: context.stayUnder }, { maxPages: MAX_PAGES, signal: context.request.signal });

/** Every entry of a list, read in pages of 100; a list longer than 10 pages is a problem. */
async function list(context: Context, path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown[]> {
  const { items, truncated } = await listPages(context, path, query);
  if (truncated) throw new ReadProblem(`${path.replace(/%2F/gi, "/")} has more than ${MAX_PAGES} pages`);
  return items;
}

/** Reports the token's expiry when GitLab gives one; a failure of this call is not a failure of the read. */
async function noteExpiry(context: Context): Promise<void> {
  try {
    const answer = parse(tokenSchema, (await context.http.request({ method: "GET", path: "/personal_access_tokens/self" }, { signal: context.request.signal })).json, "the token");
    const expires = answer.expires_at === null || answer.expires_at === undefined ? null : expiryIso(answer.expires_at);
    if (expires !== null) context.http.noteExpiresAt(expires);
  } catch (error) {
    if (context.request.signal.aborted) throw error;
  }
}

/** The newest pipeline of the merge request on its head commit, for an answer that carries no `head_pipeline`; undefined where there is none. */
async function latestPipelineOf(context: Context, base: string, ref: string, sha: string): Promise<{ readonly id: number; readonly status: string } | undefined> {
  const listed = parse(pipelinesSchema, await list(context, `${base}/pipelines`), `the pipelines of ${ref}`).filter((pipeline) => pipeline.sha === sha);
  return listed.reduce<(typeof listed)[number] | undefined>((newest, pipeline) => (newest === undefined || pipeline.id > newest.id ? pipeline : newest), undefined);
}

/**
 * The reviewers' review states of a merge request, or undefined where GitLab will not give them (an instance without
 * the endpoint answers 404, a token that may not read it 403): the merge request is still read, without reviewers.
 */
async function readReviewers(context: Context, base: string, ref: string): Promise<ItemSnapshot["reviewers"]> {
  try {
    return reviewerStates(parse(reviewersSchema, await list(context, `${base}/reviewers`), `the reviewers of ${ref}`));
  } catch (error) {
    if (error instanceof HttpError && (error.kind === "forbidden" || error.kind === "not-found")) return undefined;
    throw error;
  }
}

async function readItem(context: Context, item: WatchedItem, withEvents: boolean): Promise<{ snapshot: ItemSnapshot; events: ActivityEvent[] }> {
  const { request } = context;
  const target = parseRef(item.ref);
  const base = `/projects/${context.project}/${target.kind}/${target.iid}`;
  const answer = await get(context, base);
  const isMergeRequest = target.kind === "merge_requests";
  const found = isMergeRequest ? parse(mergeRequestSchema, answer, `merge request ${item.ref}`) : parse(issueSchema, answer, `issue ${item.ref}`);
  if (found.iid !== target.iid) throw new ReadProblem(`${item.ref} answered another item`);

  const transitions: Transition[] = [
    ...labelTransitions(await list(context, `${base}/resource_label_events`), request.labels, request.since),
    ...stateTransitions(await list(context, `${base}/resource_state_events`), request.since),
  ];
  let checks: ItemSnapshot["checks"] = null;
  if ("sha" in found) {
    if (!transitions.some((t) => t.kind === "merged")) {
      const merged = mergedFromFields(found, request.since);
      if (merged !== null) transitions.push(merged);
    }
    try {
      // The head pipeline is the merge request's own: a pipeline of an older commit, or a failed one a rerun has since passed, says nothing of it now.
      const head = found.head_pipeline ?? (await latestPipelineOf(context, base, item.ref, found.sha));
      const outcome = head === undefined ? null : checksOutcome([head.status]);
      if (outcome !== null) checks = { sha: found.sha, outcome };
    } catch (error) {
      // A project with CI off, or a token that may not read pipelines, leaves the merge request without checks and still read.
      if (!(error instanceof HttpError && error.kind === "forbidden")) throw error;
    }
  }

  const reviewers = isMergeRequest ? await readReviewers(context, base, item.ref) : undefined;
  const snapshot: ItemSnapshot = {
    role: item.role,
    ref: item.ref,
    url: found.web_url,
    open: found.state === "opened" || found.state === "locked",
    merged: found.state === "merged",
    fleetLabels: fleetLabelsOf(found.labels, request.labels),
    checks,
    inPartition: inPartition(found, request.operator),
    transitions: transitions.sort(byTimeThenId),
    ...(reviewers === undefined ? {} : { reviewers }),
  };
  return { snapshot, events: withEvents ? await readEvents(context, item, base, found.web_url, isMergeRequest) : [] };
}

/** The comments (and, on a merge request, the approvals) of an item on or after `since`. */
async function readEvents(context: Context, item: WatchedItem, base: string, url: string, isMergeRequest: boolean): Promise<ActivityEvent[]> {
  const { since } = context.request;
  const events: ActivityEvent[] = [];
  const comment = (raw: unknown) => {
    const note = userNote(raw);
    if (note === null || !atOrAfter(note.created_at, since)) return;
    events.push({ id: `gitlab:note:${note.id}`, role: item.role, ref: item.ref, url, kind: "commented", actor: note.author.username, at: new Date(note.created_at).toISOString(), lastLine: lastLine(note.body) });
  };
  if (isMergeRequest) {
    for (const raw of await list(context, `${base}/discussions`)) for (const note of parse(discussionSchema, raw, "a discussion").notes) comment(note);
    const approvals = parse(approvalsSchema, await get(context, `${base}/approvals`), `the approvals of ${item.ref}`);
    for (const approval of approvals.approved_by) {
      if (!atOrAfter(approval.approved_at, since)) continue;
      events.push({
        id: `gitlab:approval:${item.ref.slice(1)}:${approval.user.id}:${approval.approved_at}`,
        role: item.role,
        ref: item.ref,
        url,
        kind: "reviewed: approved",
        actor: approval.user.username,
        at: new Date(approval.approved_at).toISOString(),
        lastLine: null,
      });
    }
  } else {
    for (const raw of await list(context, `${base}/notes`, { order_by: "created_at", sort: "desc" })) comment(raw);
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

/** The open items carrying the spec or ready label that are the operator's, as references. Each listing that fails is a failure and the rest still count. */
async function scanPartition(context: Context): Promise<string[]> {
  const { labels, operator } = context.request;
  const refs = new Set<string>();
  for (const kind of ["issues", "merge_requests"] as const) {
    for (const label of new Set([labels.spec, labels.ready])) {
      for (const filter of [{ assignee_username: operator }, { author_username: operator, assignee_id: "None" }]) {
        const found = await guarded(context, null, async () => list(context, `/projects/${context.project}/${kind}`, { state: "opened", labels: label, ...filter }));
        for (const raw of found ?? []) {
          const entry = await guarded(context, null, async () => parse(listedSchema, raw, `a ${kind} listing entry`));
          if (entry !== undefined) refs.add(refOf(kind, entry.iid));
        }
      }
    }
  }
  return [...refs];
}

/**
 * The items of this project GitLab lists as updated since `since`, oldest first, issues and merge requests apart. A
 * listing cut off at its page limit keeps what it read, and the earliest `updated_at` that a cut-off listing ended at is
 * `cutAt`: everything older was listed in both. It is no failure unless it is not after `since`, when the listing could
 * not move the cursor.
 */
async function listUpdated(context: Context, roleOf: (ref: string) => SourceRole): Promise<{ updated: UpdatedItem[]; cutAt: string | null }> {
  const updated: UpdatedItem[] = [];
  let cutAt: number | null = null;
  const sinceMs = Date.parse(context.request.since);
  for (const kind of ["issues", "merge_requests"] as const) {
    const found = await guarded(context, null, async () => {
      const { items, truncated } = await listPages(context, `/projects/${context.project}/${kind}`, { updated_after: context.request.since, state: "all", order_by: "updated_at", sort: "asc" });
      return { entries: items.map((raw) => parse(listedSchema, raw, `a ${kind} listing entry`)), truncated };
    });
    if (found === undefined) continue;
    for (const entry of found.entries) {
      const ref = refOf(kind, entry.iid);
      updated.push({ role: roleOf(ref), ref, url: entry.web_url, at: new Date(entry.updated_at).toISOString() });
    }
    if (!found.truncated) continue;
    const last = found.entries.length === 0 ? null : Date.parse(found.entries[found.entries.length - 1]!.updated_at);
    if (last !== null && last > sinceMs) cutAt = cutAt === null ? last : Math.min(cutAt, last);
    else context.failures.push({ ref: null, reason: `/projects/${decodeURIComponent(context.project)}/${kind} has more than ${MAX_PAGES} pages` });
  }
  return { updated, cutAt: cutAt === null ? null : new Date(cutAt).toISOString() };
}

/** Creates the adapter for GitLab, gitlab.com or self-managed; the session's base URL is the instance's `/api/v4`. */
export function createGitlabAdapter(): ServiceAdapter {
  return {
    service: "gitlab",
    async read(request: ReadRequest): Promise<ReadOutcome> {
      if (request.source.service !== "gitlab") {
        return { snapshots: [], events: [], updated: [], failures: [{ ref: null, reason: "the source is not a GitLab project" }] };
      }
      const context: Context = { request, http: request.http, project: encodeURIComponent(request.source.path), stayUnder: `/projects/${encodeURIComponent(request.source.path)}/`, failures: [] };
      const roles = new Map(request.items.map((item) => [item.ref, item.role]));
      const roleOf = (ref: string): SourceRole => roles.get(ref) ?? request.source.role;

      await noteExpiry(context);
      const snapshots = new Map<string, ItemSnapshot>();
      const events: ActivityEvent[] = [];
      const readOne = async (item: WatchedItem, withEvents: boolean) => {
        const read = await guarded(context, item.ref, () => readItem(context, item, withEvents));
        if (read === undefined) return;
        snapshots.set(item.ref, read.snapshot);
        events.push(...read.events);
      };

      for (const item of request.items) await readOne(item, !request.stateOnly && request.watchedRefs.has(item.ref));
      let updated: UpdatedItem[] = [];
      let listingCutAt: string | null = null;
      if (!request.stateOnly) {
        if (request.scanPartition) {
          for (const ref of await scanPartition(context)) {
            if (!snapshots.has(ref) && !context.failures.some((f) => f.ref === ref)) await readOne({ role: roleOf(ref), ref, url: null }, false);
          }
        }
        ({ updated, cutAt: listingCutAt } = await listUpdated(context, roleOf));
      }
      return { snapshots: [...snapshots.values()], events, updated, failures: context.failures, ...(listingCutAt === null ? {} : { listingCutAt }) };
    },
  };
}
