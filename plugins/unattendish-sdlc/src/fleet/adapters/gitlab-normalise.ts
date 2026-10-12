// What the GitLab adapter makes of GitLab's answers: the shapes it checks
// before it trusts a field, and the pure rules that turn them into the
// Fleet's words. Nothing here makes a request.
//
// Each rule rests on GitLab's own documentation (docs.gitlab.com, REST API
// v4); the adapter's header comment names the pages.
import { z } from "zod";
import { combineChecks } from "../domain/checks";
import type { ChecksOutcome, FleetLabels, Transition } from "../domain/model";

/** A read that cannot be trusted. `message` names a field or a count and never carries text written on the service. */
export class ReadProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadProblem";
  }
}

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const username = z.object({ username: z.string().min(1) });

/** An issue as `GET /projects/:id/issues/:iid` and the issues list give it. */
export const issueSchema = z.object({
  iid: z.number().int(),
  state: z.enum(["opened", "closed"]),
  labels: z.array(z.string()),
  assignees: z.array(username),
  author: username,
  web_url: z.string().min(1),
  updated_at: timestamp,
});

const pipelineSchema = z.object({ id: z.number().int(), sha: z.string().min(1), status: z.string().min(1) });

/** A merge request as `GET /projects/:id/merge_requests/:iid` gives it; `head_pipeline` is in the single answer only. */
export const mergeRequestSchema = z.object({
  iid: z.number().int(),
  state: z.enum(["opened", "closed", "locked", "merged"]),
  labels: z.array(z.string()),
  assignees: z.array(username),
  author: username,
  web_url: z.string().min(1),
  updated_at: timestamp,
  sha: z.string().min(1),
  merged_at: timestamp.nullish(),
  merged_by: username.nullish(),
  head_pipeline: pipelineSchema.nullish(),
});

/** What the adapter needs of a list entry. */
export const listedSchema = z.object({ iid: z.number().int(), web_url: z.string().min(1), updated_at: timestamp });

export const pipelinesSchema = z.array(pipelineSchema);

const isSystemSchema = z.object({ system: z.boolean() });
export const noteSchema = z.object({ id: z.number().int(), body: z.string(), author: username, created_at: timestamp });
export const discussionSchema = z.object({ notes: z.array(z.unknown()) });

export const approvalsSchema = z.object({
  approved_by: z.array(z.object({ user: z.object({ id: z.number().int(), username: z.string().min(1) }), approved_at: timestamp })),
});

const eventUser = z.object({ username: z.string().min(1) }).nullish();
const labelEventSchema = z.object({ id: z.number().int(), user: eventUser, created_at: timestamp, action: z.enum(["add", "remove"]) });
const stateEventSchema = z.object({ id: z.number().int(), user: eventUser, created_at: timestamp, state: z.string() });
const labelNameSchema = z.object({ label: z.object({ name: z.string() }).nullish() });
const stateNameSchema = z.object({ state: z.string().optional() });

export const tokenSchema = z.object({ expires_at: z.string().nullish() });

/** Checks `value` against `schema`; the problem names the fields that failed and nothing they held. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(whole answer)"))].join(", ");
  throw new ReadProblem(`${what} lacks or malforms: ${fields}`);
}

const iso = (value: string): string => new Date(value).toISOString();

/** Whether `at` is on or after `since`. */
export const atOrAfter = (at: string, since: string): boolean => Date.parse(at) >= Date.parse(since);

/** Which of the four registered labels `labels` carries, as registered; the comparison ignores case. */
export function fleetLabelsOf(labels: readonly string[], registered: FleetLabels): string[] {
  const have = new Set(labels.map((label) => label.toLowerCase()));
  const found = [registered.spec, registered.ready, registered.inProgress, registered.needsInput].filter((label) => have.has(label.toLowerCase()));
  return [...new Set(found)];
}

/** Assigned to the operator, or filed by them and assigned to nobody. */
export function inPartition(item: { readonly assignees: readonly { readonly username: string }[]; readonly author: { readonly username: string } }, operator: string): boolean {
  const who = operator.toLowerCase();
  if (item.assignees.length === 0) return item.author.username.toLowerCase() === who;
  return item.assignees.some((assignee) => assignee.username.toLowerCase() === who);
}

/**
 * How a pipeline status counts toward a merge request's checks. `canceling`
 * and `waiting_for_callback` are not final, so they are pending. A status
 * outside GitLab's documented list is null.
 */
export function pipelineOutcome(status: string): ChecksOutcome | null {
  switch (status) {
    case "success":
    case "skipped":
    case "manual":
      return "passed";
    case "failed":
    case "canceled":
      return "failed";
    case "created":
    case "waiting_for_resource":
    case "waiting_for_callback":
    case "preparing":
    case "pending":
    case "running":
    case "scheduled":
    case "canceling":
      return "pending";
    default:
      return null;
  }
}

/** The set's outcome: pending while any is, else failed if any failed, else passed; null for an empty set. */
export function checksOutcome(statuses: readonly string[]): ChecksOutcome | null {
  if (statuses.length === 0) return null;
  const outcomes = statuses.map((status) => {
    const outcome = pipelineOutcome(status);
    if (outcome === null) throw new ReadProblem("a pipeline has a status outside the documented list");
    return outcome;
  });
  return combineChecks(outcomes);
}

/** A note's author and time as the Fleet reads a comment, or null for a system note (GitLab's record of its own actions). */
export function userNote(note: unknown): z.infer<typeof noteSchema> | null {
  if (parse(isSystemSchema, note, "a note").system) return null;
  return parse(noteSchema, note, "a note");
}

/** The transitions a resource label event list reports on or after `since`, for the registered labels only. */
export function labelTransitions(events: readonly unknown[], registered: FleetLabels, since: string): Transition[] {
  const spelled = new Map([registered.spec, registered.ready, registered.inProgress, registered.needsInput].map((label) => [label.toLowerCase(), label]));
  const out: Transition[] = [];
  for (const raw of events) {
    const name = parse(labelNameSchema, raw, "a label event").label?.name;
    const label = name === undefined ? undefined : spelled.get(name.toLowerCase());
    if (label === undefined) continue;
    const event = parse(labelEventSchema, raw, "a label event");
    if (!atOrAfter(event.created_at, since)) continue;
    out.push({
      kind: event.action === "add" ? "labelled" : "unlabelled",
      label,
      actor: event.user?.username ?? null,
      at: iso(event.created_at),
      id: `gitlab:label_event:${event.id}`,
    });
  }
  return out;
}

/**
 * The transitions a resource state event list reports on or after `since`.
 * GitLab's pages show `opened` and `closed` as states and say the list does
 * not track the initial state, so an `opened` entry can only be a reopening.
 * `locked` is not a change the Fleet reads.
 */
export function stateTransitions(events: readonly unknown[], since: string): Transition[] {
  const kinds: Readonly<Record<string, Transition["kind"]>> = { closed: "closed", reopened: "reopened", opened: "reopened", merged: "merged" };
  const out: Transition[] = [];
  for (const raw of events) {
    const kind = kinds[parse(stateNameSchema, raw, "a state event").state ?? ""];
    if (kind === undefined) continue;
    const event = parse(stateEventSchema, raw, "a state event");
    if (!atOrAfter(event.created_at, since)) continue;
    out.push({ kind, actor: event.user?.username ?? null, at: iso(event.created_at), id: `gitlab:state_event:${event.id}` });
  }
  return out;
}

/**
 * The merge a merge request's own fields report, for when its state events
 * hold none: GitLab's pages do not list `merged` among a state event's
 * values, but they do give a merged request `merged_at`.
 */
export function mergedFromFields(mr: { readonly iid: number; readonly state: string; readonly merged_at?: string | null | undefined; readonly merged_by?: { readonly username: string } | null | undefined }, since: string): Transition | null {
  if (mr.state !== "merged" || mr.merged_at === undefined || mr.merged_at === null || !atOrAfter(mr.merged_at, since)) return null;
  return { kind: "merged", actor: mr.merged_by?.username ?? null, at: iso(mr.merged_at), id: `gitlab:merged:${mr.iid}` };
}

export const byTimeThenId = (a: Transition, b: Transition): number => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id);

/** `YYYY-MM-DD` (what a personal access token's `expires_at` is) or a timestamp, as ISO 8601 UTC; null where it is neither. */
export function expiryIso(value: string): string | null {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
