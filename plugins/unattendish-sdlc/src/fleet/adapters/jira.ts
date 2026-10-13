// The Jira Cloud adapter: reads one Jira project through REST API v3 and
// normalises what it finds. It decides nothing about waking.
//
// What each call rests on (Atlassian's OpenAPI description,
// https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json, read 2026-10-12, unless a page is named):
//   GET /rest/api/3/search/jql    the current search; the old /rest/api/3/search is removed. Token-paged
//                                 (`nextPageToken`, absent on the last page; `isLast`), `fields` defaults to `id` only,
//                                 and the query must be bounded (every query here names the project).
//   GET /rest/api/3/issue/{key}   `fields=` restricts; `expand=changelog` returns the newest 100 histories and a `total`.
//                                 "if the identifier doesn't match an issue, a case-insensitive search and check for
//                                 moved issues is performed. If a matching issue is found its details are returned, a
//                                 302 or other redirect is not returned. The issue key returned in the response is the
//                                 key of the issue found": a moved issue answers to its old key under its new one, so
//                                 the answer's `key` is checked against the fleet's project. Answers 401 for
//                                 "authentication credentials ... incorrect or missing" and 404 for "not found or the
//                                 user does not have permission to view it"; no 403 is documented for it, nor for
//                                 the changelog, comment, status or search reads (the HTTP layer keeps any 403 as
//                                 `forbidden`, a per-read failure).
//   GET /rest/api/3/issue/{key}/changelog   `startAt`/`maxResults` (default 100), oldest first, `isLast`.
//   GET /rest/api/3/issue/{key}/comment     `startAt`/`maxResults`/`total`, `orderBy` of `created`, `-created` or `+created`,
//                                           `body` in Atlassian Document Format (see jira-adf.ts).
//   GET /rest/api/3/status        every status with `statusCategory.key`; `new`, `indeterminate` and `done` are the keys.
//   Timestamps look like `2021-01-17T12:34:00.000+0000` in the OpenAPI examples (offset without a colon).
//   Rate limits (https://developer.atlassian.com/cloud/jira/platform/rate-limiting/): 429 with `Retry-After`.
// JQL (https://support.atlassian.com/jira-software-cloud/docs/jql-fields/ and .../jql-functions/):
//   `updated` takes "yyyy/MM/dd HH:mm" or a relative "-Nm" ("w", "d", "h", "m"), never seconds, so it is minute
//   precision, and an absolute time is read in the searching user's configured time zone, which the adapter cannot
//   know. It sends a relative time, which no zone changes, a little wider than needed, and keeps only the items whose
//   returned `updated` is at or after `since`. `labels = "x"`, `assignee is EMPTY`, `statusCategory = Done` ("a work
//   item is resolved when statusCategory = Done") and `assignee`/`creator` by account id or email are documented.
//
// The updated listing is read `ORDER BY updated ASC` ("JQL keywords", https://support.atlassian.com/jira-core-cloud/docs/advanced-search-reference-jql-keywords/:
//   ORDER BY sorts "by the values" of a field, `ASC` overriding the field's own order, and goes at the end of the query).
//   The search/jql reference, which pages by token, says nothing on whether the order holds across pages (its page
//   would not load in full when read), so a listing cut off at its page limit is trusted only if the times it listed
//   did run oldest first: it then moves the cursor to the last time it reached, or, where that is not after the cursor
//   (a bulk edit put more than a listing holds inside the window), is skipped and noted. Any other cut-off is a failure.
//
// Not confirmed by Atlassian's documentation, so taken at the cheapest fallback:
//   - a `status` changelog item's `from`/`to` being status ids and `fromString`/`toString` names: the status list
//     is looked up by id, then by name, and an item that matches neither fails to read;
//   - a `labels` changelog item's `fromString`/`toString` being the space-separated label lists: Jira labels hold no
//     spaces, so the lists are split on whitespace and compared as sets;
//   - whether JQL `labels` comparison ignores case: every snapshot is compared case-insensitively here regardless;
//   - whether Jira answers `ETag`/`If-None-Match` on these reads: the session sends a conditional request whenever an
//     earlier answer carried an ETag, and nothing else depends on it.
import { z } from "zod";
import { HttpError, type ServiceAdapter, type ReadRequest } from "../application/ports";
import type { ActivityEvent, FleetLabels, ItemSnapshot, ListingSkipped, ReadFailure, ReadOutcome, Transition, UpdatedItem, WatchedItem } from "../domain/model";
import { lastLine } from "../domain/text";
import { documentText, isDocument } from "./jira-adf";
import { failureOf, isFatal, ReadProblem } from "./service-support";

const SEARCH = "/rest/api/3/search/jql";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const user = z.object({ accountId: z.string(), emailAddress: z.string().nullish(), displayName: z.string().nullish() });
type User = z.infer<typeof user>;

const issueAnswer = z.object({
  key: z.string(),
  fields: z.object({
    status: z.object({ statusCategory: z.object({ key: z.string() }) }),
    labels: z.array(z.string()),
    assignee: user.nullable(),
    creator: user.nullable(),
  }),
  changelog: z.object({ total: z.number(), histories: z.array(z.unknown()) }).optional(),
});

const history = z.object({
  id: z.string(),
  created: z.string(),
  author: user.nullish(),
  items: z.array(z.object({ field: z.string(), from: z.string().nullish(), fromString: z.string().nullish(), to: z.string().nullish(), toString: z.string().nullish() })),
});

const comment = z.object({
  id: z.string(),
  created: z.string(),
  author: user.nullish(),
  body: z.unknown().refine(isDocument),
});

const statusList = z.array(z.object({ id: z.string(), name: z.string(), statusCategory: z.object({ key: z.string() }) }));
const listing = z.object({ issues: z.array(z.unknown()), nextPageToken: z.string().nullish(), isLast: z.boolean().nullish() });
const listed = z.object({ key: z.string(), fields: z.object({ updated: z.string() }) });
const changelogPage = z.object({ values: z.array(z.unknown()), total: z.number(), isLast: z.boolean().nullish() });
const commentPage = z.object({ comments: z.array(z.unknown()), total: z.number() });

/** A Jira timestamp (`2021-01-17T12:34:00.000+0000`) as ISO 8601 UTC, or null when it is not one. */
const toIso = (text: string): string | null => {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)(Z|[+-]\d\d(?::?\d\d)?)$/.exec(text);
  if (match === null) return null;
  const offset = match[2] === "Z" ? "Z" : match[2]!.length === 3 ? `${match[2]}:00` : match[2]!.replace(/^([+-]\d\d)(\d\d)$/, "$1:$2");
  const parsed = new Date(`${match[1]}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/**
 * The email address Jira shows for a person, which an echo actor may have been registered under; the account id is the
 * actor itself. A display name is never an alias: anyone can choose one, so a teammate could pass for an echo actor.
 */
const aliasesOf = (account: User | null | undefined): { actorAliases?: string[] } => {
  const email = account?.emailAddress;
  return typeof email === "string" && email.trim() !== "" ? { actorAliases: [email] } : {};
};

const quote = (value: string): string => `"${value.replace(/[\\"]/g, "\\$&")}"`;
const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const isUser = (account: User | null | undefined, operator: string): boolean =>
  account !== null && account !== undefined && (sameText(account.accountId, operator) || sameText(account.emailAddress ?? "", operator));
const words = (text: string | null | undefined): string[] => (text ?? "").split(/\s+/).filter((word) => word !== "");

const registeredLabels = (labels: FleetLabels): string[] => [labels.spec, labels.ready, labels.inProgress, labels.needsInput];

/** An issue whose key belongs to a project other than the fleet's. */
class OutsideFleet extends ReadProblem {}

/** The project part of an issue key (`PROJ` of `PROJ-12`). */
const projectOf = (key: string): string => key.slice(0, key.lastIndexOf("-"));

/** The reason a failed read gives: its own words, or an `HttpError`'s, which never carry a token or a query string. */
const reasonOf = (error: unknown): string => {
  if (error instanceof HttpError || error instanceof ReadProblem) return error.message;
  if (error instanceof z.ZodError) return `answer is not of the documented shape at ${error.issues[0]?.path.join(".") || "its root"}`;
  return "unexpected failure while reading";
};

/** How the updated listing ended, when it was cut off at its page limit and the cut-off is no failure. */
interface UpdatedListing {
  readonly cutAt?: string;
  readonly skipped?: ListingSkipped;
}

type StatusCategories = { readonly byId: Map<string, string>; readonly byName: Map<string, string> };

class Reading {
  private readonly snapshots: ItemSnapshot[] = [];
  private readonly events: ActivityEvent[] = [];
  private readonly updated: UpdatedItem[] = [];
  private readonly failures: ReadFailure[] = [];
  private readonly sinceMs: number;
  private readonly site: string;
  private readonly project: string;
  private categories: Promise<StatusCategories> | null = null;

  constructor(
    private readonly request: ReadRequest,
    site: string,
    project: string,
  ) {
    this.sinceMs = Date.parse(request.since);
    this.site = site;
    this.project = project;
  }

  async run(): Promise<ReadOutcome> {
    const seen = new Set<string>();
    for (const item of this.request.items) {
      if (seen.has(item.ref.toUpperCase())) continue;
      seen.add(item.ref.toUpperCase());
      await this.item(item);
    }
    let listing: UpdatedListing = {};
    if (!this.request.stateOnly) {
      if (this.request.scanPartition) await this.scan(seen);
      listing = await this.listUpdated();
    }
    return {
      snapshots: this.snapshots,
      events: this.events,
      updated: this.updated,
      failures: this.failures,
      ...(listing.cutAt === undefined ? {} : { listingCutAt: listing.cutAt }),
      ...(listing.skipped === undefined ? {} : { listingSkipped: listing.skipped }),
    };
  }

  // ---- shared ----

  private url(key: string): string {
    return `https://${this.site}/browse/${key}`;
  }

  /** Rethrows what ends the whole read, else records the failure for `ref`. */
  private settle(error: unknown, ref: string | null): void {
    if (isFatal(error)) throw error;
    if (this.request.signal.aborted) throw error;
    this.failures.push(error instanceof OutsideFleet ? { ref, reason: error.message, kind: "outside-fleet" } : failureOf(ref, error, reasonOf(error)));
  }

  private async get(path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
    return (await this.request.http.request({ method: "GET", path, query }, { signal: this.request.signal })).json;
  }

  private statusCategories(): Promise<StatusCategories> {
    this.categories ??= this.get("/rest/api/3/status").then((json) => {
      const byId = new Map<string, string>();
      const byName = new Map<string, string>();
      for (const status of statusList.parse(json)) {
        byId.set(status.id, status.statusCategory.key);
        byName.set(status.name.toLowerCase(), status.statusCategory.key);
      }
      return { byId, byName };
    });
    return this.categories;
  }

  // ---- one item ----

  private async item(item: WatchedItem): Promise<void> {
    try {
      const read = await this.readItem(item.ref, this.request.watchedRefs.has(item.ref), false);
      this.snapshots.push(read.snapshot);
      this.events.push(...read.events);
    } catch (error) {
      this.settle(error, item.ref);
    }
  }

  private async readItem(ref: string, watched: boolean, inPartitionByService: boolean): Promise<{ snapshot: ItemSnapshot; events: ActivityEvent[] }> {
    const key = encodeURIComponent(ref);
    const answer = issueAnswer.parse(await this.get(`/rest/api/3/issue/${key}`, { fields: "status,labels,assignee,creator", expand: "changelog" }));
    if (!sameText(projectOf(answer.key), this.project)) throw new OutsideFleet("moved outside the fleet");
    const { fields } = answer;
    const operator = this.request.operator;
    const carried = new Set(fields.labels.map((label) => label.toLowerCase()));

    const transitions = await this.transitions(await this.histories(key, answer.changelog), ref);
    const events = this.request.stateOnly || !watched ? [] : await this.comments(ref, key, answer.key);
    const snapshot: ItemSnapshot = {
      role: "tracker",
      ref,
      url: this.url(answer.key),
      open: fields.status.statusCategory.key !== "done",
      merged: false,
      fleetLabels: registeredLabels(this.request.labels).filter((label, i, all) => carried.has(label.toLowerCase()) && all.findIndex((other) => sameText(other, label)) === i),
      inPartition: inPartitionByService || isUser(fields.assignee, operator) || (isUser(fields.creator, operator) && fields.assignee === null),
      transitions,
    };
    return { snapshot, events };
  }

  /** The issue's changelog entries: the page `expand=changelog` returned when it holds them all, else every page of the changelog. */
  private async histories(key: string, expanded: { total: number; histories: unknown[] } | undefined): Promise<unknown[]> {
    if (expanded !== undefined && expanded.histories.length >= expanded.total) return expanded.histories;
    const found = new Map<string, unknown>();
    for (let page = 0, startAt = 0; ; page += 1) {
      if (page >= MAX_PAGES) throw new ReadProblem(`the changelog of ${decodeURIComponent(key)} is longer than ${MAX_PAGES} pages of ${PAGE_SIZE}`);
      const answer = changelogPage.parse(await this.get(`/rest/api/3/issue/${key}/changelog`, { startAt, maxResults: PAGE_SIZE }));
      for (const raw of answer.values) found.set(String((raw as { id?: unknown } | null)?.id ?? found.size), raw);
      startAt += answer.values.length;
      if (answer.values.length === 0 || answer.isLast === true || startAt >= answer.total) return [...found.values()];
    }
  }

  /** The transitions the changelog reports at or after `since`, oldest first. */
  private async transitions(histories: unknown[], ref: string): Promise<Transition[]> {
    const found: Transition[] = [];
    const registered = registeredLabels(this.request.labels);
    const dated = histories.map((raw) => {
      const at = toIso(z.object({ created: z.string() }).parse(raw).created);
      if (at === null) throw new ReadProblem(`a changelog entry of ${ref} has no valid time`);
      return { raw, at };
    });
    dated.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || history.parse(a.raw).id.localeCompare(history.parse(b.raw).id, undefined, { numeric: true }));
    for (const { raw, at } of dated) {
      if (Date.parse(at) < this.sinceMs) continue;
      const entry = history.parse(raw);
      const actor = entry.author?.accountId ?? null;
      const aliases = aliasesOf(entry.author);
      const made: Omit<Transition, "id">[] = [];
      for (const change of entry.items) {
        if (change.field === "status") {
          const from = await this.categoryOf(change.from, change.fromString);
          const to = await this.categoryOf(change.to, change.toString);
          if (from !== "done" && to === "done") made.push({ kind: "closed", actor, ...aliases, at });
          else if (from === "done" && to !== "done") made.push({ kind: "reopened", actor, ...aliases, at });
        } else if (change.field === "labels") {
          const before = new Set(words(change.fromString).map((label) => label.toLowerCase()));
          const after = new Set(words(change.toString).map((label) => label.toLowerCase()));
          for (const label of registered) {
            const lower = label.toLowerCase();
            if (after.has(lower) && !before.has(lower)) made.push({ kind: "labelled", label, actor, ...aliases, at });
            else if (before.has(lower) && !after.has(lower)) made.push({ kind: "unlabelled", label, actor, ...aliases, at });
          }
        }
      }
      for (const transition of made) found.push({ ...transition, id: `jira:changelog:${entry.id}:${transition.kind}${transition.label === undefined ? "" : `:${transition.label.toLowerCase()}`}` });
    }
    return found;
  }

  private async categoryOf(id: string | null | undefined, name: string | null | undefined): Promise<string> {
    const categories = await this.statusCategories();
    const found = (id === null || id === undefined ? undefined : categories.byId.get(id)) ?? (name === null || name === undefined ? undefined : categories.byName.get(name.toLowerCase()));
    if (found === undefined) throw new ReadProblem("a status change names a status the site's status list does not hold");
    return found;
  }

  /** Every comment created at or after `since`, newest page first, oldest first in the result. */
  private async comments(ref: string, key: string, issueKey: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    for (let page = 0, startAt = 0; ; page += 1) {
      const answer = commentPage.parse(await this.get(`/rest/api/3/issue/${key}/comment`, { orderBy: "-created", startAt, maxResults: PAGE_SIZE }));
      let reachedOlder = false;
      for (const raw of answer.comments) {
        const at = toIso(z.object({ created: z.string() }).parse(raw).created);
        if (at === null) throw new ReadProblem(`a comment on ${ref} has no valid time`);
        if (Date.parse(at) < this.sinceMs) {
          reachedOlder = true;
          continue;
        }
        const parsed = comment.parse(raw);
        events.push({ id: `jira:comment:${parsed.id}`, role: "tracker", ref, url: this.url(issueKey), kind: "commented", actor: parsed.author?.accountId ?? null, ...aliasesOf(parsed.author), at, lastLine: lastLine(documentText(parsed.body)) });
      }
      startAt += answer.comments.length;
      if (reachedOlder || answer.comments.length === 0 || startAt >= answer.total) break;
      if (page + 1 >= MAX_PAGES) throw new ReadProblem(`the comments on ${ref} run to more than ${MAX_PAGES} pages of ${PAGE_SIZE}`);
    }
    return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  // ---- listings ----

  /** Every issue a search lists, or what it listed before the cut-off. */
  private async search(jql: string): Promise<{ issues: unknown[]; truncated: boolean }> {
    const issues: unknown[] = [];
    let token: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) return { issues, truncated: true };
      const answer = listing.parse(await this.get(SEARCH, { jql, fields: "updated", maxResults: PAGE_SIZE, nextPageToken: token }));
      issues.push(...answer.issues);
      if (answer.isLast === true || answer.nextPageToken === null || answer.nextPageToken === undefined) return { issues, truncated: false };
      token = answer.nextPageToken;
    }
  }

  /** Whether a listing's hit belongs to another project, which is recorded as a failure and never read. */
  private refuseListed(key: string): boolean {
    if (sameText(projectOf(key), this.project)) return false;
    this.failures.push({ ref: key, reason: "listed outside the fleet", kind: "outside-fleet" });
    return true;
  }

  /** Open issues labelled spec or ready that the operator holds, read as snapshots. */
  private async scan(seen: Set<string>): Promise<void> {
    const who = quote(this.request.operator);
    const jql =
      `project = ${quote(this.project)} AND labels in (${[this.request.labels.spec, this.request.labels.ready].map(quote).join(", ")})` +
      ` AND statusCategory != Done AND (assignee = ${who} OR (creator = ${who} AND assignee is EMPTY)) ORDER BY updated ASC`;
    let found: { issues: unknown[]; truncated: boolean };
    try {
      found = await this.search(jql);
    } catch (error) {
      this.settle(error, null);
      return;
    }
    if (found.truncated) this.failures.push({ ref: null, reason: `the partition listing runs to more than ${MAX_PAGES} pages of ${PAGE_SIZE}` });
    for (const raw of found.issues) {
      const hit = listed.safeParse(raw);
      if (!hit.success) {
        this.failures.push({ ref: null, reason: "the partition listing holds an issue without its key" });
        continue;
      }
      const ref = hit.data.key;
      if (this.refuseListed(ref)) continue;
      if (seen.has(ref.toUpperCase())) continue;
      seen.add(ref.toUpperCase());
      try {
        this.snapshots.push((await this.readItem(ref, false, true)).snapshot);
      } catch (error) {
        this.settle(error, ref);
      }
    }
  }

  /**
   * The issues the site lists as updated since `since`, to the minute and a little wider, then cut exactly at `since`.
   * The listing is oldest first. One cut off at its page limit is no failure, provided the times it listed did run
   * oldest first: where the last is after `since` it is returned as `cutAt`; where every one is at or before `since`,
   * as when a bulk edit updated more issues within the window than the listing holds, the listing is `skipped`, with
   * the window it covered and the last time it reached. Otherwise the cut-off is a failure with no ref, as the order is then not to be trusted to skip
   * nothing.
   */
  private async listUpdated(): Promise<UpdatedListing> {
    const startedMs = Date.now();
    const minutes = Math.max(2, Math.ceil((startedMs - this.sinceMs) / 60_000) + 2);
    let found: { issues: unknown[]; truncated: boolean };
    try {
      found = await this.search(`project = ${quote(this.project)} AND updated >= "-${minutes}m" ORDER BY updated ASC`);
    } catch (error) {
      this.settle(error, null);
      return {};
    }
    let last: number | null = null;
    let ordered = true;
    for (const raw of found.issues) {
      const hit = listed.safeParse(raw);
      const at = hit.success ? toIso(hit.data.fields.updated) : null;
      if (!hit.success || at === null) {
        this.failures.push({ ref: hit.success ? hit.data.key : null, reason: "the updated listing holds an issue without a valid key and update time" });
        continue;
      }
      const time = Date.parse(at);
      if (last !== null && time < last) ordered = false;
      last = time;
      if (this.refuseListed(hit.data.key)) continue;
      if (time >= this.sinceMs) this.updated.push({ role: "tracker", ref: hit.data.key, url: this.url(hit.data.key), at });
    }
    if (!found.truncated) return {};
    if (ordered && last !== null) {
      if (last > this.sinceMs) return { cutAt: new Date(last).toISOString() };
      // Jira resolves `-Nm` against its own clock and to the minute, so the window starts at a minute, and no later than the
      // update the listing reached whatever the clocks say.
      const from = Math.floor(Math.min(startedMs - minutes * 60_000, last) / 60_000) * 60_000;
      return { skipped: { from: new Date(from).toISOString(), to: new Date(startedMs).toISOString(), reached: new Date(last).toISOString() } };
    }
    this.failures.push({ ref: null, reason: `the updated listing runs to more than ${MAX_PAGES} pages of ${PAGE_SIZE}` });
    return {};
  }
}

/** Reads one Jira Cloud project: `request.source` names its site and key, and `request.http` is bound to `https://<site>`. */
export function createJiraAdapter(): ServiceAdapter {
  return {
    service: "jira",
    async read(request) {
      const { source } = request;
      if (source.role !== "tracker" || source.service !== "jira") {
        return { snapshots: [], events: [], updated: [], failures: [{ ref: null, reason: "the source is not a Jira project" }] };
      }
      return new Reading(request, source.site, source.project).run();
    },
  };
}
