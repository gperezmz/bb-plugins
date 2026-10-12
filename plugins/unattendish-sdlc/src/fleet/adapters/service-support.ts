// What the four service adapters (GitHub, GitLab, Linear, Jira) do alike when a
// read goes wrong: the error for an answer they cannot use, the check of an
// answer against a shape, and the rule for which errors end the whole read.
import type { z } from "zod";
import { HttpError } from "../application/ports";

/** A read that cannot be trusted. `message` names a field or a count and never carries text written on the service. */
export class ReadProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadProblem";
  }
}

/** How a failed check words itself; the fields are named and none of their values is quoted. */
export interface ParseReport {
  /** What a path-less issue (the whole answer) is called. */
  readonly root: string;
  /** The most fields the message names; all where absent. */
  readonly limit?: number;
  /** The message of the `ReadProblem`, given the names of the offending fields joined with `, `. */
  readonly message: (fields: string) => string;
}

/** Checks `value` against `schema`, or throws a `ReadProblem` that names the offending fields and nothing they held. */
export const parseAnswer = <T>(schema: z.ZodType<T>, value: unknown, report: ParseReport): T => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || report.root))];
  throw new ReadProblem(report.message(fields.slice(0, report.limit).join(", ")));
};

/** Whether an error ends the whole read, a refused credential or a rate limit; any other error fails only the item it came from. */
export const isFatal = (error: unknown): error is HttpError => error instanceof HttpError && (error.kind === "auth" || error.kind === "rate-limit");
