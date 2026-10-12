// What a fleet can be watched with right now: its credentials, its manifest,
// and from those its sources and its watched set.
import { defaultServiceOfHost, forgeSource, formatRepo, formatTracker, trackerSource } from "../domain/identity";
import type { ManifestRead, NotWatched, Registration, UnreadableRow, WatchedSet } from "../domain/model";
import { watchedSet } from "../domain/watched";
import { credentialRefused } from "../domain/registration";
import type { Credentials, ManifestFiles, ResolvedSource, StoredFleet } from "./ports";

export interface Watching {
  readonly manifest: ManifestRead;
  readonly watched: WatchedSet;
  readonly unreadableRows: readonly UnreadableRow[];
  /** The fleet's forge, where a credential is chosen for it. */
  readonly forge: ResolvedSource | null;
  /** The fleet's tracker where it is a service of its own and a credential is chosen for it. */
  readonly tracker: ResolvedSource | null;
  readonly notWatched: readonly NotWatched[];
}

export const assessWatching = async (deps: { credentials: Credentials; manifests: ManifestFiles }, registration: Registration): Promise<Watching> => {
  const notWatched: NotWatched[] = [];
  const manifest = await deps.manifests.read(registration.manifestPath);
  if (manifest.status === "missing") notWatched.push({ code: "manifest-missing", text: `The manifest at ${registration.manifestPath} does not exist yet` });
  if (manifest.status === "unreadable") notWatched.push({ code: "manifest-unreadable", text: `The manifest at ${registration.manifestPath} cannot be read: ${manifest.reason}` });

  const forgeLookup = deps.credentials.forForge(registration.repo);
  let forge: ResolvedSource | null = null;
  if (forgeLookup.found && (forgeLookup.credential.service === "github" || forgeLookup.credential.service === "gitlab")) {
    forge = { credential: forgeLookup.credential, source: forgeSource(registration.repo, forgeLookup.credential.service) };
  } else {
    notWatched.push({ code: "no-credential", text: `No credential is chosen for ${formatRepo(registration.repo)}` });
  }

  let tracker: ResolvedSource | null = null;
  const separate = trackerSource(registration.tracker);
  if (separate !== null) {
    const lookup = deps.credentials.forTracker(registration.tracker, registration.repo);
    if (lookup.found && lookup.credential.service === separate.service) tracker = { credential: lookup.credential, source: separate };
    else notWatched.push({ code: "no-credential", text: `No credential is chosen for the tracker ${formatTracker(registration.tracker)}` });
  }

  // A credential chosen for the fleet is no use without a token: a pasted one that was never pasted, or a login that is gone.
  for (const resolved of [forge, tracker]) {
    if (resolved === null) continue;
    try {
      await deps.credentials.token(resolved.credential);
    } catch {
      notWatched.push({ code: "no-credential", text: `No token can be had for ${resolved.credential.prefix}` });
    }
  }

  const service = forge?.source.role === "forge" ? forge.source.service : (defaultServiceOfHost(registration.repo.host) ?? "github");
  const watched = manifest.status === "ok" ? watchedSet(manifest.manifest, { repo: registration.repo, tracker: registration.tracker, forge: service }) : { items: [], outside: [] };
  return { manifest, watched, unreadableRows: manifest.status === "ok" ? manifest.manifest.unreadable : [], forge, tracker, notWatched };
};

/** Why the fleet is not watched for each source whose credential counts as refused, the forge's first, each text once. */
export const refusedNotWatched = (outages: StoredFleet["outages"]): NotWatched[] => {
  const lines: NotWatched[] = [];
  for (const role of ["forge", "tracker"] as const) {
    const refused = outages[role]?.refused ?? null;
    if (refused === null) continue;
    const line = credentialRefused(refused.prefix, refused.why);
    if (!lines.some((known) => known.text === line.text)) lines.push(line);
  }
  return lines;
};

/** The earliest time a source's credential has counted as refused since, or null while none does. */
export const refusedSince = (outages: StoredFleet["outages"]): string | null =>
  [outages.forge?.refused?.since, outages.tracker?.refused?.since].filter((since) => since !== undefined).sort()[0] ?? null;
