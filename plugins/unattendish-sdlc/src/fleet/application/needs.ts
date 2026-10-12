// Telling the operator, once, that a fleet newly needs an account or credential for one of its halves.
import { formatRepo } from "../domain/identity";
import type { NotWatched, Registration } from "../domain/model";
import type { DashboardEvents } from "./ports";

/** The reasons a credential is behind: a half no account or credential reads, or one its credential cannot read with. */
const credentialReasons = (lines: readonly NotWatched[]): NotWatched[] => lines.filter((line) => line.role !== undefined && (line.code === "no-credential" || line.code === "credential-refused"));

/** Publishes a `fleet-needs` signal for each credential reason in `after` that `before` did not hold. */
export const announceNeeds = (events: DashboardEvents, registration: Registration, before: readonly NotWatched[], after: readonly NotWatched[]): void => {
  const known = new Set(credentialReasons(before).map((line) => `${line.role}\u0000${line.text}`));
  for (const line of credentialReasons(after)) {
    if (known.has(`${line.role}\u0000${line.text}`)) continue;
    events.fleetNeeds({ fleet: formatRepo(registration.repo), managerThreadId: registration.managerThreadId, role: line.role!, text: line.text });
  }
};
