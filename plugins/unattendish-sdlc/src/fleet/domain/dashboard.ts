// The rules behind what the dashboard shows of a fleet: which rows count, why a
// fleet is not fully watched, what to warn of, why an item is watched, how
// dropped changes group, and which repository a thread's remote names.
import { parseRepo, repoId } from "./identity";
import type { FleetLabels, InboxRow, LandedRow, NotWatched, NotWatchedCode, RepoRef, SourceCursor, SourceRole, UnreadableRow } from "./model";
import type { WatchedWithReasons } from "./watched";

export const DAY_MS = 86_400_000;

// ---- counts ----

/** How many days back the Landed count and list reach. */
export const LANDED_DAYS = 7;

/** Landed rows merged in the `days` days before `now`, newest first. A row whose time cannot be read is left out. */
export const landedWithin = <Row extends Pick<LandedRow, "merged">>(landed: readonly Row[], now: Date, days: number): Row[] => {
  const from = now.getTime() - days * DAY_MS;
  return landed
    .filter((row) => {
      const merged = Date.parse(row.merged);
      return !Number.isNaN(merged) && merged >= from;
    })
    .sort((a, b) => Date.parse(b.merged) - Date.parse(a.merged));
};

/** Rows of the Inbox the plugin could not read: they wait on the operator all the same. */
export const unreadableInbox = (unreadable: readonly UnreadableRow[]): UnreadableRow[] => unreadable.filter((row) => row.section === "Inbox");

/** Inbox rows oldest wait first, ties by Ref. A time that cannot be read sorts last. */
export const oldestFirst = <Row extends Pick<InboxRow, "since" | "ref">>(rows: readonly Row[]): Row[] => {
  const time = (row: Row): number => {
    const at = Date.parse(row.since);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  return [...rows].sort((a, b) => (time(a) === time(b) ? (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) : time(a) < time(b) ? -1 : 1));
};

// ---- why a fleet is not fully watched ----

/** Where a problem is fixed: Connect… for the half a credential problem is about, or the Fleet tab for the manifest. */
export type Fix = { readonly kind: "connect"; readonly role: SourceRole } | { readonly kind: "fleet-tab" } | { readonly kind: "none" };

/** Renew… for an expired token: the credential it replaces, its account and the half it serves. */
export interface RenewFix {
  readonly kind: "renew";
  readonly role: SourceRole;
  readonly accountId: string;
  readonly credentialId: string;
}

/** A token whose expiry has passed, which Renew… puts right. */
export interface ExpiredProblem {
  readonly code: "token-expired";
  /** `GitHub · yuser: token expired`; a page counts the days in the operator's own calendar. */
  readonly text: string;
  readonly fix: RenewFix;
  readonly label: string;
  readonly expiresAt: string;
}

export type Problem =
  | {
      readonly code: NotWatchedCode | "unreadable-rows" | "manager-gone" | "left-behind";
      readonly text: string;
      readonly fix: Fix;
    }
  | ExpiredProblem;

/** Where each reason is fixed: a credential through Connect… for its half, the manifest on the Fleet tab, which shows its state and why it cannot be read. */
const fixOf = (line: NotWatched): Fix => {
  if (line.code === "manifest-missing" || line.code === "manifest-unreadable") return { kind: "fleet-tab" };
  return line.role === undefined ? { kind: "none" } : { kind: "connect", role: line.role };
};

/** `3 manifest rows cannot be read: In flight, Inbox`: how many and in which sections, sections sorted; null when every row reads. */
export const unreadableRowsText = (unreadable: readonly UnreadableRow[]): string | null => {
  if (unreadable.length === 0) return null;
  const sections = [...new Set(unreadable.map((row) => row.section))].sort();
  const n = unreadable.length;
  return `${n} manifest ${n === 1 ? "row cannot" : "rows cannot"} be read: ${sections.join(", ")}`;
};

/** What a fleet whose manager thread is archived or gone says: nothing on the page fixes it, a new manager does. */
export const MANAGER_GONE_TEXT = "The manager thread is archived or gone: run /run-fleet in a new thread to take the fleet over";

/** What a left-behind fleet says: what its manifest names now, and how to unregister it. Nothing on the page fixes it. */
export const leftBehindText = (fleet: string, names: string): string =>
  `Its manifest now names ${names}, so nothing in it is this fleet's. Unregister it with \`bb unattendish fleet unregister ${fleet}\`.`;

/** A left-behind fleet: the fleet's own name, and the repository its manifest names. */
export interface LeftBehind {
  readonly fleet: string;
  readonly names: string;
}

/**
 * The fleet's problems, each text once: that it is left behind (`leftBehind`), then what `notWatched` says, then its
 * expired tokens (`expired`), then the unreadable rows, then a manager that is gone (`managerGone`). A half whose
 * token has expired says only that: the expiry is why the service refuses it, so its refusal is not said too.
 */
export const problemsOf = (
  notWatched: readonly NotWatched[],
  unreadable: readonly UnreadableRow[],
  managerGone = false,
  leftBehind: LeftBehind | null = null,
  expired: readonly ExpiredProblem[] = [],
): Problem[] => {
  const problems: Problem[] = leftBehind === null ? [] : [{ code: "left-behind", text: leftBehindText(leftBehind.fleet, leftBehind.names), fix: { kind: "none" } }];
  const expiredRoles = new Set(expired.map((problem) => problem.fix.role));
  for (const line of notWatched) {
    if (line.code === "credential-refused" && line.role !== undefined && expiredRoles.has(line.role)) continue;
    if (!problems.some((known) => known.text === line.text)) problems.push({ code: line.code, text: line.text, fix: fixOf(line) });
  }
  problems.push(...expired);
  const text = unreadableRowsText(unreadable);
  if (text !== null) problems.push({ code: "unreadable-rows", text, fix: { kind: "fleet-tab" } });
  if (managerGone) problems.push({ code: "manager-gone", text: MANAGER_GONE_TEXT, fix: { kind: "none" } });
  return problems;
};

// ---- warnings ----

export const EXPIRY_WARNING_DAYS = 7;

export type Warning =
  | { readonly kind: "expires"; readonly label: string; readonly credentialId: string; readonly accountId: string; readonly role: SourceRole; readonly expiresAt: string; readonly daysLeft: number }
  | { readonly kind: "shares-rate-limit"; readonly label: string }
  | { readonly kind: "polling-late"; readonly lastPolledAt: string }
  | { readonly kind: "never-polled" };

/** How many poll intervals may pass since the last poll before polling counts as late: one missed poll is normal, two are not. */
export const LATE_AFTER_INTERVALS = 2;

/**
 * What a fleet's polling warns of: `never-polled` before its first poll, `polling-late` once the last poll is more
 * than `LATE_AFTER_INTERVALS` intervals before `now`, and nothing otherwise, a time that cannot be read included.
 */
export const pollingWarning = (lastPolledAt: string | null, intervalMs: number, now: Date): Warning | null => {
  if (lastPolledAt === null) return { kind: "never-polled" };
  const since = now.getTime() - Date.parse(lastPolledAt);
  return since > LATE_AFTER_INTERVALS * intervalMs ? { kind: "polling-late", lastPolledAt } : null;
};

/** True where the service-reported expiry is `now` or before; false with none, or one that cannot be read. */
export const isExpired = (expiresAt: string | null, now: Date): boolean => {
  if (expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  return !Number.isNaN(at) && at <= now.getTime();
};

/** Whole days left before an expiry, counted up, where it is still ahead and within the window cards warn in; null otherwise. */
export const daysLeftToWarn = (expiresAt: string | null, now: Date): number | null => {
  if (expiresAt === null) return null;
  const left = Date.parse(expiresAt) - now.getTime();
  return Number.isNaN(left) || left <= 0 || left > EXPIRY_WARNING_DAYS * DAY_MS ? null : Math.ceil(left / DAY_MS);
};

/** A credential a fleet reads with, as its problems and warnings weigh it. */
export interface WeighedCredential {
  readonly role: SourceRole;
  readonly label: string;
  readonly credentialId: string;
  readonly accountId: string;
  readonly auth: "token" | "gh" | "glab";
  readonly expiresAt: string | null;
}

/** A problem for each credential whose service-reported expiry has passed by `now`. */
export const expiredProblems = (credentials: readonly WeighedCredential[], now: Date): ExpiredProblem[] =>
  credentials.flatMap((credential) =>
    credential.expiresAt !== null && isExpired(credential.expiresAt, now)
      ? [
          {
            code: "token-expired" as const,
            text: `${credential.label}: token expired`,
            fix: { kind: "renew" as const, role: credential.role, accountId: credential.accountId, credentialId: credential.credentialId },
            label: credential.label,
            expiresAt: credential.expiresAt,
          },
        ]
      : [],
  );

/**
 * What a card warns of for each credential the fleet uses: `expires` when the service-reported expiry is still ahead
 * and within seven days of `now` (one already passed is a problem instead), and `shares-rate-limit` for a gh or glab
 * login.
 */
export const credentialWarnings = (credentials: readonly WeighedCredential[], now: Date): Warning[] => {
  const warnings: Warning[] = [];
  for (const credential of credentials) {
    const daysLeft = daysLeftToWarn(credential.expiresAt, now);
    if (daysLeft !== null) warnings.push({ kind: "expires", label: credential.label, credentialId: credential.credentialId, accountId: credential.accountId, role: credential.role, expiresAt: credential.expiresAt!, daysLeft });
    if (credential.auth !== "token") warnings.push({ kind: "shares-rate-limit", label: credential.label });
  }
  return warnings;
};

// ---- the watched set, with reasons ----

export interface WatchedListing {
  readonly ref: string;
  readonly url: string | null;
  readonly why: readonly string[];
}

/**
 * Every item of the watched set with every reason it is in it: those the manifest names (as `named` says), then those
 * in the operator's partition that carry the spec or the ready label, by the label's registered name. An item the
 * manifest names that also carries a label gets that reason too. Reads the cursors' last-known state.
 */
export const listWatched = (named: readonly WatchedWithReasons[], cursors: readonly { readonly role: "forge" | "tracker"; readonly cursor: SourceCursor | null }[], labels: FleetLabels): WatchedListing[] => {
  const labelReasons = new Map<string, string[]>();
  for (const { role, cursor } of cursors) {
    for (const [id, state] of Object.entries(cursor?.items ?? {})) {
      if (!id.startsWith(`${role}:`) || !state.inPartition || !state.open) continue;
      const why = [labels.spec, labels.ready].filter((label, at, all) => state.fleetLabels.includes(label) && all.indexOf(label) === at).map((label) => `carries the ${label} label`);
      if (why.length > 0) labelReasons.set(id, why);
    }
  }
  const listing: WatchedListing[] = [];
  for (const item of named) {
    const id = `${item.role}:${item.ref}`;
    listing.push({ ref: item.ref, url: item.url, why: [...item.why, ...(labelReasons.get(id) ?? [])] });
    labelReasons.delete(id);
  }
  for (const [id, why] of labelReasons) listing.push({ ref: id.slice(id.indexOf(":") + 1), url: null, why });
  return listing;
};

// ---- the ledger ----

/** What a ledger row was done with, as the filter and the view say it. */
export type DoneWith = "woke" | "echo" | "out-of-scope" | "held" | "failed read";

const DONE_WITH: Readonly<Record<string, DoneWith>> = { wake: "woke", echo: "echo", "out-of-scope": "out-of-scope", held: "held" };

export const doneWith = (disposition: string): DoneWith => DONE_WITH[disposition] ?? "held";

/**
 * `echo: marker`, `echo: label`, `echo: echo actor`, `out of scope` or `out of scope: listing cut at its page limit`:
 * why a change was dropped. Null for a change that was not.
 */
export const droppedReason = (row: { readonly disposition: string; readonly rule: string | null }): string | null =>
  row.disposition === "echo" ? `echo: ${row.rule ?? "rule"}` : row.disposition === "out-of-scope" ? (row.rule === null ? "out of scope" : `out of scope: ${row.rule}`) : null;

/** Whether a ledger row is the entry a skipped listing wrote, which names no item and carries the window it listed. */
export const isSkippedListing = <Row extends { readonly kind: string; readonly window?: { readonly from: string; readonly to: string } | null }>(
  row: Row,
): row is Row & { readonly window: { readonly from: string; readonly to: string } } => row.kind === "skipped listing" && row.window != null;

/** Dropped changes grouped by reason, largest group first, ties by reason; each group keeps its changes in the order given. */
export const groupDropped = <Change extends { readonly reason: string }>(dropped: readonly Change[]): { reason: string; count: number; changes: Change[] }[] => {
  const groups = new Map<string, Change[]>();
  for (const change of dropped) groups.set(change.reason, [...(groups.get(change.reason) ?? []), change]);
  return [...groups.entries()]
    .map(([reason, changes]) => ({ reason, count: changes.length, changes }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
};

// ---- new Inbox rows ----

/**
 * Which Inbox rows are new: those whose id the repository has never recorded. They are announced unless this is the
 * first read of the repository's manifest since it registered (`baselined` false), when they are only recorded.
 */
export const inboxNews = (ids: readonly string[], seen: ReadonlySet<string>, baselined: boolean): { readonly fresh: string[]; readonly announce: string[] } => {
  const fresh = ids.filter((id) => !seen.has(id));
  return { fresh, announce: baselined ? fresh : [] };
};

// ---- a thread's repository ----

/** The repository a git remote names, in any of the forms git speaks (`https://host/path.git`, `git@host:path.git`, `ssh://git@host:22/path`); null for anything else. */
export const repoFromRemote = (remote: string): RepoRef | null => {
  const text = remote.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return parseRepo(`${scp[1]}/${scp[2]!.replace(/^\/+/, "")}`);
  try {
    const url = new URL(text);
    if (!["http:", "https:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(url.protocol)) return null;
    return parseRepo(`${url.hostname}${url.pathname}`);
  } catch {
    return null;
  }
};

/** Whether two repositories are one: the same host and path, without regard to case or a `.git` ending. */
export const sameRepo = (a: RepoRef, b: RepoRef): boolean => repoId(a) === repoId(b);
