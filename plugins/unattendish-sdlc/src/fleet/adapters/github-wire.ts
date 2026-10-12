// What GitHub's REST API answers, as far as the GitHub adapter reads it: the
// shapes it validates, and the small conversions from them. A shape lists only
// the fields a change depends on; anything else GitHub sends is ignored.
import { z } from "zod";

/** An answer that is not of the documented shape. `message` names fields and never carries anything the service wrote. */
export class Malformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Malformed";
  }
}

/** Parses `value` as `schema`, or throws a `Malformed` naming the offending fields and nothing of their values. */
export const parse = <T>(what: string, schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => (issue.path.length === 0 ? "(body)" : issue.path.join("."))))];
  throw new Malformed(`${what} lacked or misspelled ${fields.join(", ")}`);
};

const time = z.string().refine((text) => !Number.isNaN(Date.parse(text)), "not a time");
const login = z.object({ login: z.string() });
const actor = login.nullish();

/** A label as an issue lists it: an object with a name, or the bare name. */
const label = z.union([z.string(), z.object({ name: z.string() })]);

export const issueShape = z.object({
  number: z.number().int(),
  state: z.enum(["open", "closed"]),
  html_url: z.string().min(1),
  updated_at: time,
  labels: z.array(label),
  user: actor,
  assignees: z.array(login).optional(),
  assignee: actor,
  pull_request: z.looseObject({}).optional(),
});
export type IssueWire = z.infer<typeof issueShape>;

export const pullShape = z.object({
  merged: z.boolean(),
  state: z.enum(["open", "closed"]),
  html_url: z.string().min(1),
  head: z.object({ sha: z.string().min(1) }),
});
export type PullWire = z.infer<typeof pullShape>;

/** An entry of the repository's issue list, read for the updated listing. */
export const listedShape = z.object({ number: z.number().int(), html_url: z.string().min(1), updated_at: time });

/** An issue event, first by its type alone: an event of a type the adapter ignores need not be well formed. */
export const eventKindShape = z.object({ event: z.string() });
export const eventShape = z.object({
  id: z.number().int(),
  event: z.string(),
  created_at: time,
  actor,
  label: z.object({ name: z.string() }).nullish(),
});
export type EventWire = z.infer<typeof eventShape>;

const body = z.string().nullish();
export const commentShape = z.object({ id: z.number().int(), user: actor, body, created_at: time });
export const reviewCommentShape = commentShape.extend({ pull_request_review_id: z.number().int().nullish() });
export const reviewShape = z.object({ id: z.number().int(), user: actor, body, state: z.string(), submitted_at: time.nullish() });
export type CommentWire = z.infer<typeof commentShape>;
export type ReviewCommentWire = z.infer<typeof reviewCommentShape>;
export type ReviewWire = z.infer<typeof reviewShape>;

export const checkRunShape = z.object({ status: z.string(), conclusion: z.string().nullish() });
export const commitStatusShape = z.object({ state: z.string() });

/** The label's name whether GitHub spelled it as an object or a bare string. */
export const labelName = (wire: IssueWire["labels"][number]): string => (typeof wire === "string" ? wire : wire.name);

/** The logins an issue is assigned to; `assignees` where GitHub sent it, else the single `assignee`. */
export const assigneesOf = (issue: IssueWire): string[] => {
  if (issue.assignees !== undefined) return issue.assignees.map((assignee) => assignee.login);
  if (issue.assignee === undefined) throw new Malformed("an issue lacked assignees");
  return issue.assignee === null ? [] : [issue.assignee.login];
};

const MAX_LAST_LINE = 500;

/** The last non-blank line of a body, trimmed and cut to 500 characters; null where there is none. */
export const lastLineOf = (text: string | null | undefined): string | null => {
  if (text === null || text === undefined) return null;
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (line !== "") return Array.from(line).slice(0, MAX_LAST_LINE).join("");
  }
  return null;
};

/** The issue number of a `#<n>` reference, or null for anything else. */
export const numberOf = (ref: string): number | null => {
  const match = /^#(\d+)$/.exec(ref);
  return match === null ? null : Number(match[1]);
};

export const iso = (text: string): string => new Date(text).toISOString();
