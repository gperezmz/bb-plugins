import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import type { BlockedRow, InboxRow, InFlightRow, LandedRow, Manifest, WatchedItem } from "./model";
import { itemOfReference, watchedSet, watchedWithReasons, type FleetIdentity } from "./watched";

const SINCE = "2026-10-12T09:30:00Z";

const github: FleetIdentity = { repo: { host: "github.com", path: "org/repo" }, tracker: { kind: "forge-issues" }, forge: "github" };
const gitlab: FleetIdentity = { repo: { host: "gitlab.com", path: "group/sub/project" }, tracker: { kind: "forge-issues" }, forge: "gitlab" };
const linear: FleetIdentity = { ...github, tracker: { kind: "linear", team: "ENG" } };
const jira: FleetIdentity = { repo: { host: "github.com", path: "org/repo" }, tracker: { kind: "jira", site: "acme.atlassian.net", project: "PROJ" }, forge: "github" };

const inbox = (ref: string, link: string, line = 1): InboxRow => ({ ref, what: "w", waitsFor: "answer", since: SINCE, link, line });
const flight = (ref: string, link: string, line = 1): InFlightRow => ({ ref, work: "w", stage: "building", since: SINCE, builder: "—", link, line });
const blocked = (ref: string, blockedOn: readonly string[], link: string, line = 1): BlockedRow => ({ ref, blockedOn, link, line });
const landed = (ref: string, link: string, line = 1): LandedRow => ({ ref, spec: "s", merged: SINCE, link, line });

const manifest = (rows: Partial<Pick<Manifest, "inbox" | "inFlight" | "blocked" | "landed">>): Manifest => ({
  repo: "github.com/org/repo",
  inbox: [],
  inFlight: [],
  blocked: [],
  landed: [],
  unreadable: [],
  ...rows,
});

const NO_LINK = "this thread, message 1, 2026-10-12T09:30:00Z";

/** The refs a one-row Inbox watches, by role and reference. */
const watched = (fleet: FleetIdentity, ref: string, link = NO_LINK) => watchedSet(manifest({ inbox: [inbox(ref, link)] }), fleet);
const refs = (items: readonly WatchedItem[]): string[] => items.map((item) => `${item.role}:${item.ref}`);

describe("watchedSet: references", () => {
  it("watches #n as a forge item on either forge", () => {
    for (const fleet of [github, gitlab]) expect(watched(fleet, "#163").items).toEqual([{ role: "forge", ref: "#163", url: null }]);
  });

  it("watches !n as a GitLab merge request and refuses it on GitHub", () => {
    expect(watched(gitlab, "!45").items).toEqual([{ role: "forge", ref: "!45", url: null }]);
    expect(watched(github, "!45")).toEqual({ items: [], outside: [{ text: "!45", section: "Inbox", line: 1 }] });
  });

  it("names nothing for a Ref of — and a Link that is not a URL", () => {
    expect(watched(github, "—", "this thread, message 4, 2026-10-12T09:30:00Z")).toEqual({ items: [], outside: [] });
    expect(watched(github, "—", "thread thr_abc, message 4, 2026-10-12T09:30:00Z")).toEqual({ items: [], outside: [] });
    expect(watched(github, "—", "mailto:a@b.c")).toEqual({ items: [], outside: [] });
  });

  it("watches a key when the tracker is Linear with that team, ignoring case", () => {
    expect(watched(linear, "ENG-212").items).toEqual([{ role: "tracker", ref: "ENG-212", url: null }]);
    expect(watched(linear, "eng-7").items).toEqual([{ role: "tracker", ref: "ENG-7", url: null }]);
  });

  it("watches a key when the tracker is Jira with that project, ignoring case", () => {
    expect(watched(jira, "PROJ-12").items).toEqual([{ role: "tracker", ref: "PROJ-12", url: null }]);
    expect(watched(jira, "proj_x-1").outside).toHaveLength(1);
    expect(watched(jira, "Proj-3").items).toEqual([{ role: "tracker", ref: "PROJ-3", url: null }]);
  });

  it("refuses a key of another team or project, and a Linear key under a Jira fleet", () => {
    expect(watched(linear, "OPS-1")).toEqual({ items: [], outside: [{ text: "OPS-1", section: "Inbox", line: 1 }] });
    expect(watched(jira, "ENG-212")).toEqual({ items: [], outside: [{ text: "ENG-212", section: "Inbox", line: 1 }] });
    expect(watched(jira, "PROJECT-1").items).toEqual([]);
    expect(watched(linear, "ENGX-1").items).toEqual([]);
  });

  it("refuses any key when the tracker is the forge's issues", () => {
    expect(watched(github, "ENG-212")).toEqual({ items: [], outside: [{ text: "ENG-212", section: "Inbox", line: 1 }] });
    expect(watched(gitlab, "PROJ-12").items).toEqual([]);
  });

  it("keeps #n a forge item whatever the tracker", () => {
    expect(watched(linear, "#5").items).toEqual([{ role: "forge", ref: "#5", url: null }]);
    expect(watched(jira, "#5").items).toEqual([{ role: "forge", ref: "#5", url: null }]);
  });

  it("reads #007 and #7 as one item", () => {
    expect(refs(watchedSet(manifest({ inbox: [inbox("#007", NO_LINK), inbox("#7", NO_LINK)] }), github).items)).toEqual(["forge:#7"]);
  });
});

describe("watchedSet: links", () => {
  it.each([
    ["https://github.com/org/repo/issues/163", "#163"],
    ["https://github.com/org/repo/pull/171", "#171"],
    ["https://GitHub.com/Org/Repo/pull/171/files", "#171"],
    ["https://github.com/org/repo/pull/171#issuecomment-5", "#171"],
    ["http://github.com/org/repo/issues/9?x=1", "#9"],
  ])("resolves the GitHub link %s to %s", (link, ref) => {
    expect(watched(github, "—", link)).toEqual({ items: [{ role: "forge", ref, url: link }], outside: [] });
  });

  it.each([
    ["https://gitlab.com/group/sub/project/-/issues/12", "#12"],
    ["https://gitlab.com/group/sub/project/issues/12", "#12"],
    ["https://gitlab.com/group/sub/project/-/merge_requests/45", "!45"],
    ["https://gitlab.com/group/sub/project/-/merge_requests/45/diffs", "!45"],
  ])("resolves the GitLab link %s to %s", (link, ref) => {
    expect(watched(gitlab, "—", link)).toEqual({ items: [{ role: "forge", ref, url: link }], outside: [] });
  });

  it("resolves a Linear link to its key", () => {
    const link = "https://linear.app/acme/issue/ENG-212/make-it-so";
    expect(watched(linear, "—", link)).toEqual({ items: [{ role: "tracker", ref: "ENG-212", url: link }], outside: [] });
    expect(watched(linear, "—", "https://linear.app/acme/issue/ENG-9").items).toEqual([{ role: "tracker", ref: "ENG-9", url: "https://linear.app/acme/issue/ENG-9" }]);
  });

  it("resolves a Jira link to its key", () => {
    const link = "https://acme.atlassian.net/browse/PROJ-12";
    expect(watched(jira, "—", link)).toEqual({ items: [{ role: "tracker", ref: "PROJ-12", url: link }], outside: [] });
  });

  it.each([
    ["a lookalike host", "https://gitlab.com.evil.net/group/sub/project/-/issues/1", gitlab],
    ["a lookalike host on GitHub", "https://github.com.evil.net/org/repo/issues/1", github],
    ["an unrelated host", "https://example.net/x", github],
    ["another repository", "https://github.com/org/other/issues/1", github],
    ["a longer repository name", "https://github.com/org/repo-two/issues/1", github],
    ["another owner", "https://github.com/other/repo/pull/1", github],
    ["a GitHub link under a GitLab fleet", "https://github.com/org/repo/issues/1", gitlab],
    ["a merge request link under a GitHub fleet", "https://github.com/org/repo/-/merge_requests/1", github],
    ["the repository page", "https://github.com/org/repo", github],
    ["a page that is no item", "https://github.com/org/repo/issues", github],
    ["a new-issue page", "https://github.com/org/repo/issues/new", github],
    ["a number with a suffix", "https://github.com/org/repo/issues/12abc", github],
    ["the project page", "https://gitlab.com/group/sub/project", gitlab],
    ["a GitLab pull-style path", "https://gitlab.com/group/sub/project/pull/1", gitlab],
    ["another Linear team", "https://linear.app/acme/issue/OPS-1/x", linear],
    ["a Linear link under a forge-issues fleet", "https://linear.app/acme/issue/ENG-1/x", github],
    ["a Linear link under a Jira fleet", "https://linear.app/acme/issue/PROJ-1/x", jira],
    ["a Linear page that is no issue", "https://linear.app/acme/team/ENG/all", linear],
    ["a Linear lookalike host", "https://linear.app.evil.net/acme/issue/ENG-1/x", linear],
    ["another Jira site", "https://other.atlassian.net/browse/PROJ-1", jira],
    ["another Jira project", "https://acme.atlassian.net/browse/OPS-1", jira],
    ["a Jira link under a Linear fleet", "https://acme.atlassian.net/browse/ENG-1", linear],
    ["a Jira board", "https://acme.atlassian.net/jira/software/projects/PROJ/boards/1", jira],
    ["a Jira lookalike host", "https://acme.atlassian.net.evil.net/browse/PROJ-1", jira],
  ])("refuses %s", (_name, link, fleet) => {
    expect(watched(fleet, "—", link)).toEqual({ items: [], outside: [{ text: link, section: "Inbox", line: 1 }] });
  });

  it("names a Ref and a Link it refuses separately", () => {
    const set = watchedSet(manifest({ inFlight: [flight("OPS-4", "https://example.net/x", 17)] }), linear);
    expect(set.outside).toEqual([
      { text: "OPS-4", section: "In flight", line: 17 },
      { text: "https://example.net/x", section: "In flight", line: 17 },
    ]);
  });
});

describe("watchedSet: sections", () => {
  it("reads Inbox, In flight and Blocked rows, a Blocked on column, and not Landed", () => {
    const set = watchedSet(
      manifest({
        inbox: [inbox("#1", "https://github.com/org/repo/issues/1")],
        inFlight: [flight("#2", "https://github.com/org/repo/pull/3")],
        blocked: [blocked("#4", ["#5", "!6", "ENG-7"], "https://github.com/org/repo/issues/4")],
        landed: [landed("#8", "https://github.com/org/repo/pull/9")],
      }),
      github,
    );
    expect(refs(set.items)).toEqual(["forge:#1", "forge:#2", "forge:#3", "forge:#4", "forge:#5"]);
    expect(set.outside.map((o) => [o.text, o.section])).toEqual([
      ["!6", "Blocked"],
      ["ENG-7", "Blocked"],
    ]);
  });

  it("watches nothing for an empty manifest", () => {
    expect(watchedSet(manifest({}), github)).toEqual({ items: [], outside: [] });
  });

  it("names the section and line of the row", () => {
    const set = watchedSet(
      manifest({
        inbox: [inbox("#1", "https://example.net/a", 9)],
        blocked: [blocked("#2", ["OPS-1"], "https://example.net/b", 25)],
      }),
      github,
    );
    expect(set.outside).toEqual([
      { text: "https://example.net/a", section: "Inbox", line: 9 },
      { text: "OPS-1", section: "Blocked", line: 25 },
      { text: "https://example.net/b", section: "Blocked", line: 25 },
    ]);
  });

  it("gives line 0 to a row built without one", () => {
    const row: InboxRow = { ref: "OPS-1", what: "w", waitsFor: "answer", since: SINCE, link: NO_LINK };
    expect(watchedSet(manifest({ inbox: [row] }), github).outside).toEqual([{ text: "OPS-1", section: "Inbox", line: 0 }]);
  });
});

describe("watchedSet: one item named twice", () => {
  it("is one item for a Ref and its Link, carrying the URL", () => {
    const link = "https://github.com/org/repo/pull/5";
    expect(watched(github, "#5", link)).toEqual({ items: [{ role: "forge", ref: "#5", url: link }], outside: [] });
  });

  it("is one item across sections, carrying the first URL any mention gave", () => {
    const set = watchedSet(
      manifest({
        inbox: [inbox("#5", NO_LINK)],
        inFlight: [flight("#6", "https://github.com/org/repo/pull/5")],
        blocked: [blocked("#7", ["#5"], "https://github.com/org/repo/issues/7")],
      }),
      github,
    );
    expect(set.items).toEqual([
      { role: "forge", ref: "#5", url: "https://github.com/org/repo/pull/5" },
      { role: "forge", ref: "#6", url: null },
      { role: "forge", ref: "#7", url: "https://github.com/org/repo/issues/7" },
    ]);
  });

  it("keeps the first URL when a later mention gives another", () => {
    const set = watchedSet(manifest({ inbox: [inbox("#5", "https://github.com/org/repo/issues/5"), inbox("#5", "https://github.com/org/repo/pull/5")] }), github);
    expect(set.items).toEqual([{ role: "forge", ref: "#5", url: "https://github.com/org/repo/issues/5" }]);
  });

  it("is one item for a tracker key written in two cases", () => {
    const set = watchedSet(manifest({ inbox: [inbox("eng-1", "https://linear.app/acme/issue/ENG-1/x")], blocked: [blocked("#2", ["ENG-1"], "https://github.com/org/repo/issues/2")] }), linear);
    expect(set.items).toEqual([
      { role: "tracker", ref: "ENG-1", url: "https://linear.app/acme/issue/ENG-1/x" },
      { role: "forge", ref: "#2", url: "https://github.com/org/repo/issues/2" },
    ]);
  });

  it("keeps a forge #5 and a tracker item apart", () => {
    const set = watchedSet(manifest({ inbox: [inbox("#5", NO_LINK), inbox("ENG-5", NO_LINK)] }), linear);
    expect(refs(set.items)).toEqual(["forge:#5", "tracker:ENG-5"]);
  });

  it("lists items in the order they were first named: a row's Ref, its Blocked on, then its Link", () => {
    const set = watchedSet(manifest({ blocked: [blocked("#3", ["#2", "#1"], "https://github.com/org/repo/issues/9")] }), github);
    expect(refs(set.items)).toEqual(["forge:#3", "forge:#2", "forge:#1", "forge:#9"]);
  });
});

describe("watchedSet: from a parsed manifest", () => {
  it("carries the file's lines into the outside links", () => {
    const text = `# Fleet: github.com/org/repo\n\n## In flight\n\n| Ref | Work | Stage | Since | Builder | Link |\n| --- | --- | --- | --- | --- | --- |\n| #1 | a | building | ${SINCE} | — | https://github.com/org/repo/pull/2 |\n| #3 | b | building | ${SINCE} | — | https://github.com/other/repo/pull/4 |\n`;
    const read = parseManifest(text);
    if (read.status !== "ok") throw new Error("expected ok");
    const set = watchedSet(read.manifest, github);
    expect(refs(set.items)).toEqual(["forge:#1", "forge:#2", "forge:#3"]);
    expect(set.outside).toEqual([{ text: "https://github.com/other/repo/pull/4", section: "In flight", line: 8 }]);
  });
});

describe("watchedWithReasons", () => {
  it("gives each item every way the manifest names it, and the same items watchedSet holds", () => {
    const m = manifest({
      inbox: [inbox("#1", "https://github.com/org/repo/issues/1")],
      inFlight: [flight("#2", "https://github.com/org/repo/issues/1")],
      blocked: [blocked("#3", ["#2", "#1"], "https://github.com/org/repo/issues/3")],
    });
    const items = watchedWithReasons(m, github);
    expect(items.map((item) => [item.ref, item.why])).toEqual([
      ["#1", ["named in Inbox", "named in In flight", "named in Blocked"]],
      ["#2", ["named in In flight", "named in Blocked"]],
      ["#3", ["blocked on #2, #1"]],
    ]);
    expect(items.map(({ role, ref, url }) => ({ role, ref, url }))).toEqual(watchedSet(m, github).items);
  });
});

describe("itemOfReference", () => {
  it("names the item a reference is, and nothing for — or a reference the fleet does not hold", () => {
    expect(itemOfReference("#007", github)).toEqual({ role: "forge", ref: "#7" });
    expect(itemOfReference("eng-5", linear)).toEqual({ role: "tracker", ref: "ENG-5" });
    expect(itemOfReference("—", github)).toBeNull();
    expect(itemOfReference("ENG-5", github)).toBeNull();
  });
});
