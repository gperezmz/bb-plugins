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
// - Checks: `GET .../merge_requests/:iid/pipelines` (`id`, `sha`, `status`)
//   and the merge request's `head_pipeline`, with the status values listed
//   under "List project pipelines" in /api/pipelines/.
// - Token expiry: `GET /personal_access_tokens/self`, `expires_at` as
//   `YYYY-MM-DD` or null (/api/personal_access_tokens/).
//
// A 403 that is not a rate limit is the HTTP layer's `forbidden`: on the
// pipelines of a merge request it leaves `checks` null and the rest of the item
// is still read; anywhere else it fails that one item or listing. Only a 401 or
// a rate limit ends the read.
//
// Not confirmed by those pages, and what is done instead:
// - The text of the system notes for an approval and for a request for changes
//   is not documented, so no system note is read. An approval is read from the
//   approvals list. `reviewed: changes requested` and `reviewed: commented`
//   are never produced: no page says how a submitted review or a request for
//   changes appears in the notes, discussions or approvals lists.
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
  lastLine,
  listedSchema,
  mergedFromFields,
  mergeRequestSchema,
  parse,
  pipelinesSchema,
  ReadProblem,
  stateTransitions,
  tokenSchema,
  userNote,
} from "./gitlab-normalise";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface Context {
  readonly request: ReadRequest;
  readonly http: HttpSession;
  /** The project's `:id`, URL-encoded. */
  readonly project: string;
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
    if (error instanceof HttpError) {
      if (error.kind === "auth" || error.kind === "rate-limit") throw error;
      context.failures.push({ ref, reason: error.message });
      return undefined;
    }
    if (error instanceof ReadProblem) {
      context.failures.push({ ref, reason: error.message });
      return undefined;
    }
    throw error;
  }
}

const get = async (context: Context, path: string, query?: Record<string, string | number | undefined>): Promise<unknown> =>
  (await context.http.request({ method: "GET", path, query }, { signal: context.request.signal })).json;

/** Every entry of a list, read in pages of 100; a list longer than 10 pages is a problem. */
async function list(context: Context, path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown[]> {
  const { items, truncated } = await context.http.paginate({ path, query: { ...query, per_page: PAGE_SIZE } }, { maxPages: MAX_PAGES, signal: context.request.signal });
  if (truncated) throw new ReadProblem(`${path.replace(/%2F/gi, "/")} has more than ${MAX_PAGES} pages`);
  return items;
}

/** Reports the token's expiry when GitLab gives one; a failure of this call is not a failure of the read. */
async function noteExpiry(context: Context): Promise<void> {
  try {
    const answer = parse(tokenSchema, await get(context, "/personal_access_tokens/self"), "the token");
    const expires = answer.expires_at === null || answer.expires_at === undefined ? null : expiryIso(answer.expires_at);
    if (expires !== null) context.http.noteExpiresAt(expires);
  } catch (error) {
    if (context.request.signal.aborted) throw error;
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
      const listed = parse(pipelinesSchema, await list(context, `${base}/pipelines`), `the pipelines of ${item.ref}`);
      const pipelines = new Map(listed.filter((p) => p.sha === found.sha).map((p) => [p.id, p.status]));
      if (found.head_pipeline !== null && found.head_pipeline !== undefined && found.head_pipeline.sha === found.sha) pipelines.set(found.head_pipeline.id, found.head_pipeline.status);
      const outcome = checksOutcome([...pipelines.values()]);
      if (outcome !== null) checks = { sha: found.sha, outcome };
    } catch (error) {
      // A project with CI off, or a token that may not read pipelines, leaves the merge request without checks and still read.
      if (!(error instanceof HttpError && error.kind === "forbidden")) throw error;
    }
  }

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

/** The items of this project GitLab lists as updated since `since`. */
async function listUpdated(context: Context, roleOf: (ref: string) => SourceRole): Promise<UpdatedItem[]> {
  const updated: UpdatedItem[] = [];
  for (const kind of ["issues", "merge_requests"] as const) {
    const found = await guarded(context, null, async () => {
      const entries = await list(context, `/projects/${context.project}/${kind}`, { updated_after: context.request.since, state: "all", order_by: "updated_at", sort: "desc" });
      return entries.map((raw) => parse(listedSchema, raw, `a ${kind} listing entry`));
    });
    for (const entry of found ?? []) {
      const ref = refOf(kind, entry.iid);
      updated.push({ role: roleOf(ref), ref, url: entry.web_url, at: new Date(entry.updated_at).toISOString() });
    }
  }
  return updated;
}

/** Creates the adapter for GitLab, gitlab.com or self-managed; the session's base URL is the instance's `/api/v4`. */
export function createGitlabAdapter(): ServiceAdapter {
  return {
    service: "gitlab",
    async read(request: ReadRequest): Promise<ReadOutcome> {
      if (request.source.service !== "gitlab") {
        return { snapshots: [], events: [], updated: [], failures: [{ ref: null, reason: "the source is not a GitLab project" }] };
      }
      const context: Context = { request, http: request.http, project: encodeURIComponent(request.source.path), failures: [] };
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
      if (!request.stateOnly) {
        if (request.scanPartition) {
          for (const ref of await scanPartition(context)) {
            if (!snapshots.has(ref) && !context.failures.some((f) => f.ref === ref)) await readOne({ role: roleOf(ref), ref, url: null }, false);
          }
        }
        updated = await listUpdated(context, roleOf);
      }
      return { snapshots: [...snapshots.values()], events, updated, failures: context.failures };
    },
  };
}
