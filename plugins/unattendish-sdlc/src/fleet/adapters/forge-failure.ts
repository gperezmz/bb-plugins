// How the GitHub and GitLab adapters word a failed read: the kind the
// application acts on, and a reason that holds no text from the service.
import { HttpError } from "../application/ports";
import type { ReadFailure } from "../domain/model";
import { failureOf, ReadProblem } from "./service-support";

/** The reason a failed read may carry: the HTTP layer's own text, or the names of the fields an answer lacked. */
const reasonOf = (error: unknown): string => (error instanceof HttpError || error instanceof ReadProblem ? error.message : "the answer could not be read");

/**
 * The failure of one read of `ref` (null for a listing). A request, redirect or next link that left the fleet's
 * repository (the HTTP layer's `outside-host`) is `outside-fleet`; any other error is kinded by `failureOf`.
 */
export const forgeFailure = (ref: string | null, error: unknown): ReadFailure =>
  error instanceof HttpError && error.kind === "outside-host" ? { ref, reason: "moved outside the fleet", kind: "outside-fleet" } : failureOf(ref, error, reasonOf(error));
