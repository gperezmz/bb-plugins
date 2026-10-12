// What a fleet can be watched with right now: who reads each of its halves,
// its manifest, and from those its sources and its watched set.
import { defaultServiceOfHost, forgeSource, trackerSource } from "../domain/identity";
import type { ManifestRead, NotWatched, RefusedWhy, Registration, SourceRole, UnreadableRow, WatchedSet } from "../domain/model";
import { watchedSet } from "../domain/watched";
import { credentialRefused } from "../domain/registration";
import { accessProblemText, halfWhat } from "../domain/accounts";
import { CredentialUnavailable, type AccessProblem, type AccountStore, type CredentialLookup, type Credentials, type ManifestFiles, type ResolvedSource, type StoredFleet } from "./ports";

/** One half as the fleet stands: who reads it, or what it needs. */
export interface HalfStanding {
  readonly role: SourceRole;
  readonly lookup: CredentialLookup;
  /** Why no token could be had for the credential found (a login signed in as someone else); null when one could. */
  readonly unavailable: string | null;
  /** Why the credential found cannot read the half, kept until a read succeeds; null when nothing says so. */
  readonly access: AccessProblem | null;
}

export interface Watching {
  readonly manifest: ManifestRead;
  readonly watched: WatchedSet;
  readonly unreadableRows: readonly UnreadableRow[];
  /** The fleet's forge, where an account with a credential is chosen for it. */
  readonly forge: ResolvedSource | null;
  /** The fleet's tracker where it is a service of its own and an account with a credential is chosen for it. */
  readonly tracker: ResolvedSource | null;
  /** The forge's half, then the tracker's where it is a service of its own. */
  readonly halves: readonly HalfStanding[];
  readonly notWatched: readonly NotWatched[];
}

/** Who reads one of a fleet's halves: the forge, or the tracker where it is a service of its own. */
export const lookupOf = (credentials: Credentials, registration: Registration, role: SourceRole): CredentialLookup =>
  role === "forge" ? credentials.forForge(registration.repo) : credentials.forTracker(registration.tracker, registration.repo);

export interface WatchingDeps {
  readonly credentials: Credentials;
  readonly manifests: ManifestFiles;
  readonly accounts: Pick<AccountStore, "accessProblems">;
}

export const assessWatching = async (deps: WatchingDeps, registration: Registration, repo: string): Promise<Watching> => {
  const notWatched: NotWatched[] = [];
  const manifest = await deps.manifests.read(registration.manifestPath);
  if (manifest.status === "missing") notWatched.push({ code: "manifest-missing", text: `The manifest at ${registration.manifestPath} does not exist yet` });
  if (manifest.status === "unreadable") notWatched.push({ code: "manifest-unreadable", text: `The manifest at ${registration.manifestPath} cannot be read: ${manifest.reason}` });

  const problems = deps.accounts.accessProblems(repo);
  const halves: HalfStanding[] = [];
  let forge: ResolvedSource | null = null;
  let tracker: ResolvedSource | null = null;
  const separate = trackerSource(registration.tracker);
  for (const role of separate === null ? (["forge"] as const) : (["forge", "tracker"] as const)) {
    const lookup = lookupOf(deps.credentials, registration, role);
    if (!lookup.found) {
      notWatched.push({ code: "no-credential", text: lookup.need, role });
      halves.push({ role, lookup, unavailable: null, access: null });
      continue;
    }
    let unavailable: string | null = null;
    try {
      await deps.credentials.token(lookup.credential);
    } catch (error) {
      // A credential is no use without a token: a login that is gone, or signed in as another user.
      unavailable = error instanceof CredentialUnavailable ? error.message : `No token can be had for ${lookup.credential.label}`;
      notWatched.push({ code: "no-credential", text: unavailable, role });
    }
    const access = problems.find((problem) => problem.role === role && problem.credentialId === lookup.credential.key) ?? null;
    if (access !== null) notWatched.push({ code: "credential-refused", text: accessProblemText(lookup.credential, halfWhat(registration.repo, registration.tracker, role)), role });
    halves.push({ role, lookup, unavailable, access });
    // A source whose token cannot be had is still read for: the read records why it failed in the ledger.
    if (role === "forge" && (lookup.credential.service === "github" || lookup.credential.service === "gitlab")) forge = { credential: lookup.credential, source: forgeSource(registration.repo, lookup.credential.service) };
    if (role === "tracker" && separate !== null && lookup.credential.service === separate.service) tracker = { credential: lookup.credential, source: separate };
  }

  const service = forge?.source.role === "forge" ? forge.source.service : (defaultServiceOfHost(registration.repo.host) ?? "github");
  const watched = manifest.status === "ok" ? watchedSet(manifest.manifest, { repo: registration.repo, tracker: registration.tracker, forge: service }) : { items: [], outside: [] };
  return { manifest, watched, unreadableRows: manifest.status === "ok" ? manifest.manifest.unreadable : [], forge, tracker, halves, notWatched };
};

/** The service behind the fleet's forge, GitHub where no account reads it. */
export const forgeServiceOf = (watching: Pick<Watching, "forge">): "github" | "gitlab" => (watching.forge?.source.role === "forge" ? watching.forge.source.service : "github");

/** Whether an outage is the credential's to fix through Connect: the service refuses it, or it cannot see what the half reads. */
export const fixedByConnect = (why: RefusedWhy): boolean => why === "refused" || why === "not-found" || why === "forbidden";

/**
 * Why the fleet is not watched for each source whose credential counts as refused, the forge's first, each text once.
 * A source whose half already says why its credential cannot read (`accessRoles`) is not said twice. Only an outage
 * Connect fixes names its half; a service that does not answer, or keeps failing to list, is not the credential's fault.
 */
export const refusedNotWatched = (outages: StoredFleet["outages"], accessRoles: readonly SourceRole[] = []): NotWatched[] => {
  const lines: NotWatched[] = [];
  for (const role of ["forge", "tracker"] as const) {
    const refused = outages[role]?.refused ?? null;
    if (refused === null || accessRoles.includes(role)) continue;
    const line = { ...credentialRefused(refused.credential, refused.why), ...(fixedByConnect(refused.why) ? { role } : {}) };
    if (!lines.some((known) => known.text === line.text)) lines.push(line);
  }
  return lines;
};

/** The roles whose half already says its credential cannot read. */
export const accessRolesOf = (watching: Pick<Watching, "halves">): SourceRole[] => watching.halves.filter((half) => half.access !== null).map((half) => half.role);

/** The earliest time a source's credential has counted as refused since, or null while none does. */
export const refusedSince = (outages: StoredFleet["outages"]): string | null =>
  [outages.forge?.refused?.since, outages.tracker?.refused?.since].filter((since) => since !== undefined).sort()[0] ?? null;
