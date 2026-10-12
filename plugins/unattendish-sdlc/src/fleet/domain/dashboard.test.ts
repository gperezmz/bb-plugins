import { describe, expect, it } from "vitest";
import { credentialWarnings, doneWith, droppedReason, groupDropped, inboxNews, landedToday, landedWithin, listWatched, localDay, oldestFirst, reasonsOf, repoFromRemote, sameRepo, unreadableInbox, unreadableRowsText } from "./dashboard";
import type { SourceCursor } from "./model";
import { watchedWithReasons } from "./watched";
import type { Manifest } from "./model";

const NOW = new Date(2026, 9, 12, 15, 0, 0);
const at = (hoursAgo: number): string => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

describe("landed counts", () => {
  it("counts the rows merged on the local date of now, whatever the time of day", () => {
    const morning = new Date(2026, 9, 12, 0, 5).toISOString();
    const lateYesterday = new Date(2026, 9, 11, 23, 55).toISOString();
    expect(landedToday([{ merged: morning }, { merged: at(1) }, { merged: lateYesterday }, { merged: "not a time" }], NOW)).toBe(2);
    expect(localDay(NOW)).toBe("2026-10-12");
  });

  it("keeps the last seven days, newest first", () => {
    const rows = [{ merged: at(24 * 8) }, { merged: at(5) }, { merged: at(24 * 6) }, { merged: at(1) }];
    expect(landedWithin(rows, NOW, 7).map((row) => row.merged)).toEqual([at(1), at(5), at(24 * 6)]);
  });
});

describe("Inbox rows", () => {
  it("counts only the unreadable rows of the Inbox as waiting", () => {
    const rows = [
      { section: "Inbox", line: 3, reason: "a" },
      { section: "In flight", line: 9, reason: "b" },
    ];
    expect(unreadableInbox(rows)).toEqual([rows[0]]);
  });

  it("lists the oldest wait first, then by Ref", () => {
    const rows = [
      { ref: "#2", since: "2026-10-12T09:00:00Z" },
      { ref: "#1", since: "2026-10-12T10:00:00Z" },
      { ref: "#0", since: "2026-10-12T09:00:00Z" },
    ];
    expect(oldestFirst(rows).map((row) => row.ref)).toEqual(["#0", "#2", "#1"]);
  });
});

describe("reasonsOf", () => {
  it("says how many manifest rows cannot be read and in which sections, sorted", () => {
    const rows = [
      { section: "Inbox", line: 3, reason: "x" },
      { section: "In flight", line: 9, reason: "x" },
      { section: "Inbox", line: 4, reason: "x" },
    ];
    expect(unreadableRowsText(rows)).toBe("3 manifest rows cannot be read: In flight, Inbox");
    expect(unreadableRowsText([rows[0]!])).toBe("1 manifest row cannot be read: Inbox");
    expect(unreadableRowsText([])).toBeNull();
  });

  it("gathers every reason with where it is put right", () => {
    const reasons = reasonsOf(
      [
        { code: "no-credential", text: "No credential is chosen for github.com/org/repo" },
        { code: "credential-refused", text: "The credential for github.com/org was refused" },
        { code: "manifest-missing", text: "The manifest does not exist yet" },
        { code: "no-credential", text: "No credential is chosen for github.com/org/repo" },
      ],
      [{ section: "Landed", line: 2, reason: "x" }],
    );
    expect(reasons.map((reason) => [reason.code, reason.fix])).toEqual([
      ["no-credential", "settings"],
      ["credential-refused", "settings"],
      ["manifest-missing", "fleet-tab"],
      ["unreadable-rows", "fleet-tab"],
    ]);
  });
});

describe("credentialWarnings", () => {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it("warns of an expiry within seven days, counting days left up", () => {
    const [warning] = credentialWarnings([{ prefix: "github.com/org", auth: "token", expiresAt: iso(2.5 * day) }], NOW);
    expect(warning).toEqual({ kind: "expires", prefix: "github.com/org", expiresAt: iso(2.5 * day), daysLeft: 3 });
  });

  it("warns at exactly seven days and not beyond", () => {
    expect(credentialWarnings([{ prefix: "p", auth: "token", expiresAt: iso(7 * day) }], NOW)).toHaveLength(1);
    expect(credentialWarnings([{ prefix: "p", auth: "token", expiresAt: iso(7 * day + 1000) }], NOW)).toEqual([]);
  });

  it("warns of an expiry already passed, with 0 days left", () => {
    expect(credentialWarnings([{ prefix: "p", auth: "token", expiresAt: iso(-3 * day) }], NOW)).toMatchObject([{ kind: "expires", daysLeft: 0 }]);
  });

  it("warns of a shared rate limit for a gh or glab login, and not for a token", () => {
    const warnings = credentialWarnings(
      [
        { prefix: "a", auth: "gh", expiresAt: null },
        { prefix: "b", auth: "glab", expiresAt: iso(day) },
        { prefix: "c", auth: "token", expiresAt: null },
      ],
      NOW,
    );
    expect(warnings.map((warning) => `${warning.kind}:${warning.prefix}`)).toEqual(["shares-rate-limit:a", "expires:b", "shares-rate-limit:b"]);
  });

  it("ignores an expiry that cannot be read", () => {
    expect(credentialWarnings([{ prefix: "p", auth: "token", expiresAt: "soon" }], NOW)).toEqual([]);
  });
});

describe("listWatched", () => {
  const labels = { spec: "spec", ready: "status:ready", inProgress: "ip", needsInput: "ni" };
  const manifest: Manifest = {
    repo: "github.com/org/repo",
    inbox: [{ ref: "#1", what: "w", waitsFor: "answer", since: "2026-10-12T09:00:00Z", link: "https://github.com/org/repo/issues/1" }],
    inFlight: [{ ref: "#2", work: "w", stage: "building", since: "2026-10-12T09:00:00Z", builder: "—", link: "https://github.com/org/repo/issues/2" }],
    blocked: [{ ref: "#3", blockedOn: ["#2"], link: "https://github.com/org/repo/issues/3" }],
    landed: [],
    unreadable: [],
  };
  const fleet = { repo: { host: "github.com", path: "org/repo" }, tracker: { kind: "forge-issues" as const }, forge: "github" as const };
  const state = (fleetLabels: string[], inPartition = true, open = true) => ({ open, merged: false, fleetLabels, inPartition });
  const cursor: SourceCursor = { since: "x", items: { "forge:#1": state(["spec", "status:ready"]), "forge:#9": state(["spec"]), "forge:#8": state(["spec"], false), "forge:#7": state(["status:ready"], true, false) } };

  it("gives each item every reason the manifest names it and the labels it carries, label-only items last", () => {
    const listing = listWatched(watchedWithReasons(manifest, fleet), [{ role: "forge", cursor }], labels);
    expect(listing.map((item) => [item.ref, item.why])).toEqual([
      ["#1", ["named in Inbox", "carries the spec label", "carries the status:ready label"]],
      ["#2", ["named in In flight", "named in Blocked"]],
      ["#3", ["blocked on #2"]],
      ["#9", ["carries the spec label"]],
    ]);
    expect(listing[0]!.url).toBe("https://github.com/org/repo/issues/1");
  });

  it("reads without a cursor", () => {
    expect(listWatched(watchedWithReasons(manifest, fleet), [{ role: "forge", cursor: null }], labels).map((item) => item.ref)).toEqual(["#1", "#2", "#3"]);
  });
});

describe("dropped changes", () => {
  it("names why a change was dropped", () => {
    expect(droppedReason({ disposition: "echo", rule: "marker" })).toBe("echo: marker");
    expect(droppedReason({ disposition: "out-of-scope", rule: null })).toBe("out of scope");
    expect(droppedReason({ disposition: "wake", rule: null })).toBeNull();
    expect(doneWith("wake")).toBe("woke");
  });

  it("groups by reason, the largest group first", () => {
    const groups = groupDropped(["echo: label", "echo: marker", "out of scope", "echo: marker", "echo: marker", "out of scope"].map((reason, at) => ({ reason, at })));
    expect(groups.map((group) => [group.reason, group.count])).toEqual([["echo: marker", 3], ["out of scope", 2], ["echo: label", 1]]);
    expect(groups[0]!.changes.map((change) => change.at)).toEqual([1, 3, 4]);
  });
});

describe("inboxNews", () => {
  it("announces the rows never recorded once the repository is baselined", () => {
    expect(inboxNews(["a", "b", "c"], new Set(["a"]), true)).toEqual({ fresh: ["b", "c"], announce: ["b", "c"] });
  });

  it("records but does not announce on the first read", () => {
    expect(inboxNews(["a", "b"], new Set(), false)).toEqual({ fresh: ["a", "b"], announce: [] });
  });

  it("finds nothing new in rows all recorded", () => {
    expect(inboxNews(["a"], new Set(["a"]), true)).toEqual({ fresh: [], announce: [] });
  });
});

describe("repoFromRemote", () => {
  it.each([
    ["https://github.com/Org/Repo.git", "github.com/Org/Repo"],
    ["https://user@github.com/org/repo", "github.com/org/repo"],
    ["git@github.com:org/repo.git", "github.com/org/repo"],
    ["ssh://git@gitlab.example.net:2222/group/sub/project.git", "gitlab.example.net/group/sub/project"],
    ["git://github.com/org/repo.git", "github.com/org/repo"],
    ["https://github.com/org/repo/", "github.com/org/repo"],
  ])("reads %s", (remote, expected) => {
    expect(repoFromRemote(remote)).toEqual({ host: expected.split("/")[0], path: expected.split("/").slice(1).join("/") });
  });

  it.each(["", "not a remote", "file:///srv/repo.git", "https://github.com", "/srv/git/repo"])("reads %j as no repository", (remote) => {
    expect(repoFromRemote(remote)).toBeNull();
  });

  it("matches a registration without regard to case or .git", () => {
    expect(sameRepo(repoFromRemote("git@GitHub.com:Org/Repo.git")!, { host: "github.com", path: "org/repo" })).toBe(true);
    expect(sameRepo(repoFromRemote("git@github.com:org/other.git")!, { host: "github.com", path: "org/repo" })).toBe(false);
  });
});
