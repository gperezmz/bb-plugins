// The watched set: which items a manifest names that the plugin may read.
// An item is watched only when it lies under the fleet's repository or
// tracker; every other reference or link is refused and named as outside.
import { forgeSource, trackerSource, urlUnder } from "./identity";
import { itemId, type Manifest, type OutsideLink, type RepoRef, type Source, type TrackerSpec, type WatchedItem, type WatchedSet } from "./model";

/** What a manifest is read against: the fleet's repository, the service behind it, and its tracker. */
export interface FleetIdentity {
  readonly repo: RepoRef;
  readonly tracker: TrackerSpec;
  readonly forge: "github" | "gitlab";
}

/** What one mention names: an item, nothing (a `—`, or a Link that is not a URL), or an item the fleet does not hold. */
type Named = { readonly kind: "item"; readonly role: WatchedItem["role"]; readonly ref: string } | { readonly kind: "none" } | { readonly kind: "outside" };

const NONE: Named = { kind: "none" };
const OUTSIDE: Named = { kind: "outside" };

const FORGE_NUMBER = /^#(\d+)$/;
const GITLAB_MERGE_REQUEST = /^!(\d+)$/;
const KEY = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

/** Digits without the zeros in front, so `#007` and `#7` are one item. */
const number = (digits: string): string => digits.replace(/^0+(?=\d)/, "");

/** `ENG-212` as a tracker item when its team or project is the fleet's, compared without case. */
const trackerKey = (tracker: TrackerSpec, key: string): Named => {
  const match = KEY.exec(key);
  if (match === null) return OUTSIDE;
  const wanted = tracker.kind === "linear" ? tracker.team : tracker.kind === "jira" ? tracker.project : null;
  if (wanted === null || match[1]!.toUpperCase() !== wanted.toUpperCase()) return OUTSIDE;
  return { kind: "item", role: "tracker", ref: `${match[1]!.toUpperCase()}-${number(match[2]!)}` };
};

/** A reference as the manifest writes it: `#163`, `!45`, `ENG-212` or `—`. */
const nameReference = (reference: string, fleet: FleetIdentity): Named => {
  if (reference === "—") return NONE;
  const forgeItem = FORGE_NUMBER.exec(reference);
  if (forgeItem !== null) return { kind: "item", role: "forge", ref: `#${number(forgeItem[1]!)}` };
  const mergeRequest = GITLAB_MERGE_REQUEST.exec(reference);
  if (mergeRequest !== null) return fleet.forge === "gitlab" ? { kind: "item", role: "forge", ref: `!${number(mergeRequest[1]!)}` } : OUTSIDE;
  return trackerKey(fleet.tracker, reference);
};

/** The item a URL under the fleet's repository points at, by the shape of its path; null for a page that is no item. */
const forgeItemOf = (source: Extract<Source, { role: "forge" }>, pathname: string): Named | null => {
  const rest = pathname.slice(source.path.length + 1).toLowerCase();
  if (source.service === "github") {
    const match = /^\/(?:issues|pull)\/(\d+)(?:\/.*)?$/.exec(rest);
    return match === null ? null : { kind: "item", role: "forge", ref: `#${number(match[1]!)}` };
  }
  const issue = /^\/(?:-\/)?issues\/(\d+)(?:\/.*)?$/.exec(rest);
  if (issue !== null) return { kind: "item", role: "forge", ref: `#${number(issue[1]!)}` };
  const mergeRequest = /^\/-\/merge_requests\/(\d+)(?:\/.*)?$/.exec(rest);
  return mergeRequest === null ? null : { kind: "item", role: "forge", ref: `!${number(mergeRequest[1]!)}` };
};

/** The item a URL on the fleet's tracker points at: `linear.app/<workspace>/issue/<KEY>-<n>[/slug]` or `<site>/browse/<KEY>-<n>`. */
const trackerItemOf = (source: Extract<Source, { role: "tracker" }>, pathname: string, tracker: TrackerSpec): Named | null => {
  const match = (source.service === "linear" ? /^\/[^/]+\/issue\/([^/]+)(?:\/.*)?$/ : /^\/browse\/([^/]+)(?:\/.*)?$/).exec(pathname);
  if (match === null) return null;
  const item = trackerKey(tracker, match[1]!);
  return item.kind === "item" ? item : null;
};

/** A Link cell: the item its URL points at when the URL lies under the fleet, nothing for text that is no URL, else outside. */
const nameLink = (link: string, fleet: FleetIdentity): Named => {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return NONE;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return NONE;
  const forge = forgeSource(fleet.repo, fleet.forge);
  if (forge.role === "forge" && urlUnder(forge, link)) {
    const item = forgeItemOf(forge, url.pathname);
    if (item !== null) return item;
  }
  const tracker = trackerSource(fleet.tracker);
  if (tracker !== null && tracker.role === "tracker" && urlUnder(tracker, link)) {
    const item = trackerItemOf(tracker, url.pathname, fleet.tracker);
    if (item !== null) return item;
  }
  return OUTSIDE;
};

/** An item the manifest names, and every way the manifest names it, in the order they were first found. */
export interface WatchedWithReasons extends WatchedItem {
  readonly why: readonly string[];
}

/** The item a reference as the manifest writes it (`#163`, `!45`, `ENG-212`) names under this fleet, or null for `—` and a reference the fleet does not hold. */
export const itemOfReference = (reference: string, fleet: FleetIdentity): Pick<WatchedItem, "role" | "ref"> | null => {
  const named = nameReference(reference, fleet);
  return named.kind === "item" ? { role: named.role, ref: named.ref } : null;
};

interface Collected {
  readonly items: readonly WatchedWithReasons[];
  readonly outside: readonly OutsideLink[];
}

const collect = (manifest: Manifest, fleet: FleetIdentity): Collected => {
  const found = new Map<string, { role: WatchedItem["role"]; ref: string; url: string | null; why: string[] }>();
  const outside: OutsideLink[] = [];
  const mention = (named: Named, text: string, section: string, line: number, url: string | null, why: string): void => {
    if (named.kind === "outside") outside.push({ text, section, line });
    if (named.kind !== "item") return;
    const key = itemId(named.role, named.ref);
    const known = found.get(key);
    if (known === undefined) found.set(key, { role: named.role, ref: named.ref, url, why: [why] });
    else {
      if (known.url === null) known.url = url;
      if (!known.why.includes(why)) known.why.push(why);
    }
  };
  const row = (section: string, line: number | undefined, ref: string, blockedOn: readonly string[], link: string): void => {
    const at = line ?? 0;
    // A Blocked row's own item is watched as blocked on what it lists; what it lists is named in Blocked.
    const why = blockedOn.length > 0 ? `blocked on ${blockedOn.join(", ")}` : `named in ${section}`;
    mention(nameReference(ref, fleet), ref, section, at, null, why);
    for (const reference of blockedOn) mention(nameReference(reference, fleet), reference, section, at, null, `named in ${section}`);
    const named = nameLink(link, fleet);
    mention(named, link, section, at, named.kind === "item" ? link : null, why);
  };
  for (const r of manifest.inbox) row("Inbox", r.line, r.ref, [], r.link);
  for (const r of manifest.inFlight) row("In flight", r.line, r.ref, [], r.link);
  for (const r of manifest.blocked) row("Blocked", r.line, r.ref, r.blockedOn, r.link);
  return { items: [...found.values()].map((item): WatchedWithReasons => ({ role: item.role, ref: item.ref, url: item.url, why: item.why })), outside };
};

/**
 * Every Ref and Link of the manifest's Inbox, In flight and Blocked rows and
 * every reference in a Blocked on column, as the items the fleet holds and the
 * mentions it does not. Landed rows are not watched. An item named twice is
 * one item, carrying the URL of the first mention that gave one, in the order
 * it was first named. An outside mention's `line` is 0 for a row built by hand
 * with no line.
 */
export function watchedSet(manifest: Manifest, fleet: FleetIdentity): WatchedSet {
  const { items, outside } = collect(manifest, fleet);
  return { items: items.map((item): WatchedItem => ({ role: item.role, ref: item.ref, url: item.url })), outside };
}

/** The items `watchedSet` holds, each with every way the manifest names it: `named in Inbox`, `named in In flight`, `named in Blocked`, or `blocked on <references>` for a Blocked row's own item. */
export function watchedWithReasons(manifest: Manifest, fleet: FleetIdentity): readonly WatchedWithReasons[] {
  return collect(manifest, fleet).items;
}
