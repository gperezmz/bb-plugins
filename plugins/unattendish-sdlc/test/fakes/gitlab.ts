// A fake GitLab (REST v4): an in-memory project of issues and merge requests
// that answers the endpoints the GitLab adapter reads, and the pipelines it never
// asks for, in the shapes docs.gitlab.com documents. It paginates with `Link` and `X-Next-Page`
// headers, orders and filters lists, and answers a repeat GET with an ETag
// as a 304 so a conditional request can be seen. Written in erasable
// TypeScript only (no enums, namespaces or parameter properties), because the
// drive harness runs it with `node` directly; it imports nothing at runtime.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FakeService } from "./listen";

export interface FakeNote {
  id: number;
  author: string;
  body: string;
  created_at: string;
  /** True for a system note ("closed", "added ~label"). */
  system?: boolean;
  /** A note on a diff line is a `DiffNote`; the rest are `DiscussionNote` or null. */
  type?: "DiffNote" | "DiscussionNote" | null;
  /** Notes sharing a discussion id are one thread; a note without one is a thread of its own. */
  discussion?: string;
}

export interface FakeLabelEvent {
  id: number;
  user: string | null;
  created_at: string;
  /** Null for a label since deleted. */
  label: string | null;
  action: "add" | "remove";
}

export interface FakeStateEvent {
  id: number;
  user: string | null;
  created_at: string;
  state: string;
}

export interface FakePipeline {
  id: number;
  sha: string;
  ref?: string;
  status: string;
}

export interface FakeApproval {
  user: string;
  approved_at: string;
}

export interface FakeItem {
  iid: number;
  /** `opened` or `closed` for an issue; also `merged` and `locked` for a merge request. */
  state: string;
  title?: string;
  description?: string;
  labels?: string[];
  author: string;
  /** Usernames. */
  assignees?: string[];
  created_at?: string;
  updated_at: string;
  web_url?: string;
  notes?: FakeNote[];
  labelEvents?: FakeLabelEvent[];
  stateEvents?: FakeStateEvent[];
  /** Fields left out of this item's answers, to script an answer that lacks one. */
  omit?: string[];
  /** The id of the issue it was moved to. GitLab keeps a moved issue in its project, closed, and answers it as before. */
  movedToId?: number;
}

export interface FakeMergeRequest extends FakeItem {
  /** The head commit of the source branch. */
  sha?: string;
  merged_at?: string | null;
  merged_by?: string | null;
  pipelines?: FakePipeline[];
  /** The `head_pipeline` of the single answer: a pipeline of any commit (a merged-results one is), or null for none. Left out, it is the newest of `pipelines` on `sha`. */
  headPipeline?: FakePipeline | null;
  approvals?: FakeApproval[];
  /** The reviewers and their `state` (`unreviewed`, `review_started`, `reviewed`, `requested_changes`, `approved`, `unapproved`), as `GET .../reviewers` lists them. */
  reviewers?: { user: string; state: string; created_at?: string }[];
}

export interface FakeProject {
  issues: FakeItem[];
  mergeRequests: FakeMergeRequest[];
}

export interface FakeGitlabState {
  /** Projects by full path (`group/sub/project`). */
  projects: Record<string, FakeProject>;
  /** The answer of `GET /personal_access_tokens/self`; null answers 404, as a token of another type does. */
  token?: { expires_at: string | null } | null;
  /** The most items per page the service gives whatever `per_page` asks, up to GitLab's 100. */
  maxPerPage?: number;
  /** Requests whose path and query string contain `match` answer `status`. */
  faults?: { match: string; status: number }[];
  /** Project paths that have been renamed or transferred, by old full path to the new one: a request under the old path answers 301 to the new. */
  renames?: Record<string, string>;
  /** A full path (API root included) every `Link: rel="next"` points at instead of the request's own, to script a link that leaves the project. */
  nextLinkPath?: string;
}

const userId = (name: string): number => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  return hash + 1;
};
const userJson = (name: string) => ({ id: userId(name), username: name, name: `Display name of ${name}`, state: "active" });

const stripped = (value: Record<string, unknown>, omit: string[] | undefined): Record<string, unknown> => {
  for (const field of omit ?? []) delete value[field];
  return value;
};

const normalise = (state: Partial<FakeGitlabState> | undefined): FakeGitlabState => ({
  projects: state?.projects ?? {},
  token: state?.token ?? null,
  maxPerPage: state?.maxPerPage ?? 100,
  faults: state?.faults ?? [],
  renames: state?.renames ?? {},
  ...(state?.nextLinkPath === undefined ? {} : { nextLinkPath: state.nextLinkPath }),
});

const time = (iso: string): number => Date.parse(iso);

export function createFakeGitlab(initial?: Partial<FakeGitlabState>): FakeService {
  let state = normalise(initial);

  const json = (response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  };

  /** Answers a GET with its ETag, or a 304 when the request already holds that one. */
  const ok = (request: IncomingMessage, response: ServerResponse, body: unknown, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    const etag = `W/"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { etag, ...headers });
      response.end();
      return;
    }
    json(response, body, 200, { etag, ...headers });
  };

  const paged = (request: IncomingMessage, response: ServerResponse, url: URL, all: unknown[]) => {
    const cap = Math.min(state.maxPerPage ?? 100, 100);
    const perPage = Math.min(Number(url.searchParams.get("per_page")) || 20, cap);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const slice = all.slice((page - 1) * perPage, page * perPage);
    const next = page * perPage < all.length ? page + 1 : null;
    const headers: Record<string, string> = { "x-page": String(page), "x-per-page": String(perPage), "x-next-page": next === null ? "" : String(next) };
    if (next !== null) {
      const params = new URLSearchParams(url.searchParams);
      params.set("page", String(next));
      headers.link = `<http://${request.headers.host}${state.nextLinkPath ?? url.pathname}?${params.toString()}>; rel="next"`;
    }
    ok(request, response, slice, headers);
  };

  const sorted = <T extends FakeItem>(items: T[], url: URL): T[] => {
    const orderBy = url.searchParams.get("order_by") === "updated_at" ? "updated_at" : "created_at";
    const direction = url.searchParams.get("sort") === "asc" ? 1 : -1;
    const at = (item: T) => time(orderBy === "updated_at" ? item.updated_at : (item.created_at ?? item.updated_at));
    return [...items].sort((a, b) => direction * (at(a) - at(b) || a.iid - b.iid));
  };

  const filtered = <T extends FakeItem>(items: T[], url: URL): T[] => {
    const q = url.searchParams;
    const wanted = q.get("state") ?? "all";
    const labels = (q.get("labels") ?? "").split(",").filter((l) => l !== "");
    const updatedAfter = q.get("updated_after");
    const assigneeId = q.get("assignee_id");
    const assigneeUsername = q.get("assignee_username");
    const authorUsername = q.get("author_username");
    return items.filter((item) => {
      if (wanted !== "all" && item.state !== wanted) return false;
      if (labels.some((label) => !(item.labels ?? []).includes(label))) return false;
      if (updatedAfter !== null && time(item.updated_at) < time(updatedAfter)) return false;
      if (assigneeId === "None" && (item.assignees ?? []).length > 0) return false;
      if (assigneeId === "Any" && (item.assignees ?? []).length === 0) return false;
      if (assigneeUsername !== null && !(item.assignees ?? []).includes(assigneeUsername)) return false;
      if (authorUsername !== null && item.author !== authorUsername) return false;
      return true;
    });
  };

  const webUrl = (request: IncomingMessage, path: string, kind: "issues" | "merge_requests", item: FakeItem): string =>
    item.web_url ?? `http://${request.headers.host}/${path}/-/${kind}/${item.iid}`;

  const itemJson = (request: IncomingMessage, path: string, item: FakeItem): Record<string, unknown> =>
    stripped(
      {
        id: 10_000 + item.iid,
        iid: item.iid,
        project_id: 7,
        title: item.title ?? `Title of ${item.iid}`,
        description: item.description ?? `Description of ${item.iid}`,
        state: item.state,
        created_at: item.created_at ?? item.updated_at,
        updated_at: item.updated_at,
        labels: item.labels ?? [],
        assignees: (item.assignees ?? []).map(userJson),
        assignee: (item.assignees ?? []).length > 0 ? userJson(item.assignees![0]!) : null,
        author: userJson(item.author),
        moved_to_id: item.movedToId ?? null,
        web_url: webUrl(request, path, "issues", item),
      },
      item.omit,
    );

  const pipelinesOf = (mr: FakeMergeRequest) => (mr.pipelines ?? []).map((p) => ({ id: p.id, sha: p.sha, ref: p.ref ?? "feature", status: p.status }));

  const mrJson = (request: IncomingMessage, path: string, mr: FakeMergeRequest, single: boolean): Record<string, unknown> => {
    const head =
      mr.headPipeline === undefined
        ? pipelinesOf(mr)
            .filter((p) => p.sha === mr.sha)
            .sort((a, b) => b.id - a.id)[0]
        : mr.headPipeline === null
          ? undefined
          : { id: mr.headPipeline.id, sha: mr.headPipeline.sha, ref: mr.headPipeline.ref ?? "feature", status: mr.headPipeline.status };
    const body: Record<string, unknown> = {
      ...itemJson(request, path, mr),
      web_url: webUrl(request, path, "merge_requests", mr),
      merged_at: mr.merged_at ?? null,
      merged_by: mr.merged_by === undefined || mr.merged_by === null ? null : userJson(mr.merged_by),
      sha: mr.sha ?? null,
      draft: false,
    };
    if (single) body.head_pipeline = head ?? null;
    return stripped(body, mr.omit);
  };

  const noteJson = (note: FakeNote, noteableType: string, iid: number) => ({
    id: note.id,
    type: note.type ?? null,
    body: note.body,
    author: userJson(note.author),
    created_at: note.created_at,
    updated_at: note.created_at,
    system: note.system === true,
    noteable_type: noteableType,
    noteable_iid: iid,
    resolvable: false,
  });

  const discussionsOf = (mr: FakeMergeRequest) => {
    const threads = new Map<string, FakeNote[]>();
    for (const note of mr.notes ?? []) {
      const key = note.discussion ?? `note-${note.id}`;
      threads.set(key, [...(threads.get(key) ?? []), note]);
    }
    return [...threads.entries()]
      .map(([id, notes]) => ({ id, individual_note: notes.length === 1, notes: notes.map((n) => noteJson(n, "MergeRequest", mr.iid)) }))
      .sort((a, b) => a.notes[0]!.id - b.notes[0]!.id);
  };

  const events = (items: FakeLabelEvent[] | FakeStateEvent[] | undefined, mapper: (event: never) => unknown): unknown[] =>
    [...(items ?? [])].sort((a, b) => a.id - b.id).map(mapper as (event: FakeLabelEvent | FakeStateEvent) => unknown);

  const labelEventJson = (iid: number, type: string) => (event: FakeLabelEvent) => ({
    id: event.id,
    user: event.user === null ? null : userJson(event.user),
    created_at: event.created_at,
    resource_type: type,
    resource_id: iid,
    label: event.label === null ? null : { id: 500 + event.id, name: event.label, color: "#428bca", description: null },
    action: event.action,
  });

  const stateEventJson = (iid: number, type: string) => (event: FakeStateEvent) => ({
    id: event.id,
    user: event.user === null ? null : userJson(event.user),
    created_at: event.created_at,
    resource_type: type,
    resource_id: iid,
    state: event.state,
    source_commit: null,
    source_merge_request_id: null,
  });

  return {
    setState(next: unknown) {
      state = normalise(next as Partial<FakeGitlabState>);
    },
    getState() {
      return state;
    },
    handle(request, _body, response) {
      const host = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${host}`);
      const marker = url.pathname.indexOf("/api/v4/");
      if (marker < 0) return false;
      const segments = url.pathname.slice(marker + "/api/v4/".length).split("/").filter((s) => s !== "");
      if (request.method !== "GET") {
        json(response, { message: "405 Method Not Allowed" }, 405);
        return true;
      }
      const fault = (state.faults ?? []).find((f) => decodeURIComponent(url.pathname + url.search).includes(f.match));
      if (fault !== undefined) {
        json(response, { message: `${fault.status} fault` }, fault.status);
        return true;
      }
      const notFound = () => {
        json(response, { message: "404 Not Found" }, 404);
        return true;
      };

      if (segments[0] === "personal_access_tokens" && segments[1] === "self") {
        if (state.token === null || state.token === undefined) return notFound();
        ok(request, response, { id: 1, name: "fleet", revoked: false, scopes: ["read_api"], active: true, expires_at: state.token.expires_at });
        return true;
      }
      if (segments[0] !== "projects" || segments[1] === undefined) return false;
      const path = decodeURIComponent(segments[1]);
      const renamed = state.renames?.[path];
      if (renamed !== undefined) {
        const moved = `${url.pathname.slice(0, marker)}/api/v4/projects/${encodeURIComponent(renamed)}/${segments.slice(2).join("/")}${url.search}`;
        json(response, { message: "301 Moved Permanently" }, 301, { location: `http://${host}${moved}` });
        return true;
      }
      const project = state.projects[path];
      if (project === undefined) return notFound();
      const kind = segments[2];
      const isMergeRequest = kind === "merge_requests";
      if (kind !== "issues" && !isMergeRequest) return false;
      const collection: FakeItem[] = isMergeRequest ? project.mergeRequests : project.issues;
      const render = (item: FakeItem, single: boolean) => (isMergeRequest ? mrJson(request, path, item as FakeMergeRequest, single) : itemJson(request, path, item));

      if (segments[3] === undefined) {
        const rows = sorted(filtered(collection, url), url).map((item) => render(item, false));
        paged(request, response, url, rows);
        return true;
      }
      const iid = Number(segments[3]);
      const item = collection.find((candidate) => candidate.iid === iid);
      if (item === undefined) return notFound();
      const type = isMergeRequest ? "MergeRequest" : "Issue";
      const sub = segments[4];
      if (sub === undefined) {
        ok(request, response, render(item, true));
        return true;
      }
      if (sub === "notes" && !isMergeRequest) {
        const direction = url.searchParams.get("sort") === "asc" ? 1 : -1;
        const notes = [...(item.notes ?? [])].sort((a, b) => direction * (time(a.created_at) - time(b.created_at) || a.id - b.id));
        paged(request, response, url, notes.map((n) => noteJson(n, "Issue", item.iid)));
        return true;
      }
      if (sub === "resource_label_events") {
        paged(request, response, url, events(item.labelEvents, labelEventJson(item.iid, type)));
        return true;
      }
      if (sub === "resource_state_events") {
        paged(request, response, url, events(item.stateEvents, stateEventJson(item.iid, type)));
        return true;
      }
      if (isMergeRequest) {
        const mr = item as FakeMergeRequest;
        if (sub === "discussions") {
          paged(request, response, url, discussionsOf(mr));
          return true;
        }
        if (sub === "pipelines") {
          paged(request, response, url, pipelinesOf(mr).sort((a, b) => b.id - a.id));
          return true;
        }
        if (sub === "reviewers") {
          const requested = mr.created_at ?? mr.updated_at;
          paged(request, response, url, (mr.reviewers ?? []).map((r) => ({ user: userJson(r.user), state: r.state, created_at: r.created_at ?? requested })));
          return true;
        }
        if (sub === "approvals") {
          ok(
            request,
            response,
            stripped({ id: 20_000 + mr.iid, iid: mr.iid, approved_by: (mr.approvals ?? []).map((a) => ({ user: userJson(a.user), approved_at: a.approved_at })) }, mr.omit?.filter((f) => f.startsWith("approvals.")).map((f) => f.slice("approvals.".length))),
          );
          return true;
        }
      }
      return notFound();
    },
  };
}
