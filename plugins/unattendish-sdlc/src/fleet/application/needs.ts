// Telling the operator, once, that a fleet newly needs an account or credential for one of its halves.
import { isExpired } from "../domain/dashboard";
import { formatRepo } from "../domain/identity";
import type { NotWatched, Registration, SourceRole } from "../domain/model";
import type { AccountStore, Credentials, DashboardEvents } from "./ports";
import { expiriesOf } from "./fleet-views";
import type { FleetNeedsSignal } from "./views";
import { lookupOf } from "./watching";

/** The reasons a credential is behind: a half no account or credential reads, or one its credential cannot read with. */
const credentialReasons = (lines: readonly NotWatched[]): NotWatched[] => lines.filter((line) => line.role !== undefined && (line.code === "no-credential" || line.code === "credential-refused"));

/** The credential reading a half, where its service-reported expiry has passed by `now`; null otherwise. */
export const expiredTokenOf = (deps: { readonly credentials: Credentials; readonly accounts: AccountStore }, registration: Registration, role: SourceRole, now: Date): FleetNeedsSignal["expired"] => {
  const lookup = lookupOf(deps.credentials, registration, role);
  if (!lookup.found) return null;
  const credential = lookup.credential;
  const expiresAt = expiriesOf(deps).get(credential.key) ?? null;
  return expiresAt !== null && isExpired(expiresAt, now) ? { label: credential.label, accountId: credential.accountId, credentialId: credential.key, expiresAt } : null;
};

/**
 * Publishes a `fleet-needs` signal for each credential reason in `after` that `before` did not hold. A line
 * `expiredOf` names an expired token for (the service refusing it, as the caller decides) carries that token, so the
 * toast offers Renew… for it.
 */
export const announceNeeds = (
  events: DashboardEvents,
  registration: Registration,
  before: readonly NotWatched[],
  after: readonly NotWatched[],
  expiredOf: (line: NotWatched) => FleetNeedsSignal["expired"] = () => null,
): void => {
  const known = new Set(credentialReasons(before).map((line) => `${line.role}\u0000${line.text}`));
  for (const line of credentialReasons(after)) {
    if (known.has(`${line.role}\u0000${line.text}`)) continue;
    const expired = expiredOf(line);
    events.fleetNeeds({ fleet: formatRepo(registration.repo), managerThreadId: registration.managerThreadId, role: line.role!, text: line.text, expired });
  }
};
