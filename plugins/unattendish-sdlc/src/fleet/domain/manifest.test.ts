import { describe, expect, it } from "vitest";
import type { Manifest } from "./model";
import { MAX_WRITTEN_CHARS, parseManifest, parseMessageLink, writtenSections } from "./manifest";

const FULL = `# Fleet: GitHub.com/org/repo

Some prose the plugin does not read.

## Inbox

| Ref | What | Waits for | Since | Link |
| --- | --- | --- | --- | --- |
| #163 | Which cache to use | answer | 2026-10-12T09:30:00+02:00 | https://github.com/org/repo/issues/163 |
| — | Merge the rollout | grant | 2026-10-12T07:30:00Z | this thread, message 12, 2026-10-12T07:29:00+00:00 |
| ENG-212 | Ready the \\| spec | ready | 2026-10-12T07:30:00.250Z | [ENG-212](https://linear.app/acme/issue/ENG-212/slug) |
| — | merge it, the grant's own words | grant | 2026-10-12T07:30Z | thread thr_abc123, message 4, 2026-10-11T18:00:00-05:00 |

## In flight

| Ref | Work | Stage | Since | Builder | Link |
| --- | --- | --- | --- | --- | --- |
| #170 | Parser | building | 2026-10-12T09:30:00Z | thr_ycfbv7t94q | \`https://github.com/org/repo/pull/171\` |
| #171 | Watch set | waiting on you | 2026-10-12T09:30:00Z | — | <https://github.com/org/repo/pull/172> |

## Blocked

| Ref | Blocked on | Link |
| --- | --- | --- |
| #180 | #170, ENG-212 , !4 | https://github.com/org/repo/issues/180 |

## Landed

| Ref | Spec | Merged | Link |
| --- | --- | --- | --- |
| #150 | Earlier spec | 2026-10-01T12:00:00Z | https://github.com/org/repo/pull/151 |

## Notes

| Ref | What |
| --- | --- |
| nonsense | this section is shown as written |
`;

const ok = (text: string): Manifest => {
  const read = parseManifest(text);
  if (read.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(read)}`);
  return read.manifest;
};

const INBOX_HEAD = "# Fleet: github.com/org/repo\n\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n";
const FLIGHT_HEAD = "# Fleet: github.com/org/repo\n\n## In flight\n\n| Ref | Work | Stage | Since | Builder | Link |\n| --- | --- | --- | --- | --- | --- |\n";
const BLOCKED_HEAD = "# Fleet: github.com/org/repo\n\n## Blocked\n\n| Ref | Blocked on | Link |\n| --- | --- | --- |\n";
const LANDED_HEAD = "# Fleet: github.com/org/repo\n\n## Landed\n\n| Ref | Spec | Merged | Link |\n| --- | --- | --- | --- |\n";

const URL163 = "https://github.com/org/repo/issues/163";
const TIME = "2026-10-12T09:30:00+02:00";

/** The reasons of the unreadable rows `text` gives, with their line. */
const failures = (text: string): readonly { section: string; line: number; reason: string }[] => ok(text).unreadable;

describe("parseManifest: the whole manifest", () => {
  it("reads every section into rows in file order, with their lines", () => {
    const manifest = ok(FULL);
    expect(manifest.repo).toBe("github.com/org/repo");
    expect(manifest.unreadable).toEqual([]);
    expect(manifest.inbox).toEqual([
      { ref: "#163", what: "Which cache to use", waitsFor: "answer", since: TIME, link: URL163, line: 9 },
      { ref: "—", what: "Merge the rollout", waitsFor: "grant", since: "2026-10-12T07:30:00Z", link: "this thread, message 12, 2026-10-12T07:29:00+00:00", line: 10 },
      { ref: "ENG-212", what: "Ready the | spec", waitsFor: "ready", since: "2026-10-12T07:30:00.250Z", link: "https://linear.app/acme/issue/ENG-212/slug", line: 11 },
      { ref: "—", what: "merge it, the grant's own words", waitsFor: "grant", since: "2026-10-12T07:30Z", link: "thread thr_abc123, message 4, 2026-10-11T18:00:00-05:00", line: 12 },
    ]);
    expect(manifest.inFlight).toEqual([
      { ref: "#170", work: "Parser", stage: "building", since: "2026-10-12T09:30:00Z", builder: "thr_ycfbv7t94q", link: "https://github.com/org/repo/pull/171", line: 18 },
      { ref: "#171", work: "Watch set", stage: "waiting on you", since: "2026-10-12T09:30:00Z", builder: "—", link: "https://github.com/org/repo/pull/172", line: 19 },
    ]);
    expect(manifest.blocked).toEqual([{ ref: "#180", blockedOn: ["#170", "ENG-212", "!4"], link: "https://github.com/org/repo/issues/180", line: 25 }]);
    expect(manifest.landed).toEqual([{ ref: "#150", spec: "Earlier spec", merged: "2026-10-01T12:00:00Z", link: "https://github.com/org/repo/pull/151", line: 31 }]);
  });

  it("reads CRLF line endings and a byte order mark", () => {
    const manifest = ok(`﻿${FULL.replace(/\n/g, "\r\n")}`);
    expect(manifest.unreadable).toEqual([]);
    expect(manifest.inbox).toHaveLength(4);
    expect(manifest.inbox[0]).toMatchObject({ ref: "#163", link: URL163, line: 9 });
  });

  it("reads section headings and column names without regard to case or order", () => {
    const manifest = ok(`# Fleet: github.com/org/repo\n\n## IN FLIGHT\n\n| link | builder | SINCE | stage | work | ref |\n|:--|--:|:-:|---|---|---|\n| https://github.com/org/repo/pull/1 | — | ${TIME} | asking | Do it | #1 |\n`);
    expect(manifest.inFlight).toEqual([{ ref: "#1", work: "Do it", stage: "asking", since: TIME, builder: "—", link: "https://github.com/org/repo/pull/1", line: 7 }]);
  });

  it("reads a table without outer pipes and extra columns it does not know", () => {
    const manifest = ok(`# Fleet: github.com/org/repo\n\n## Blocked\n\nRef | Blocked on | Note | Link\n--- | --- | --- | ---\n#2 | #1 | waiting | ${URL163}\n`);
    expect(manifest.blocked).toEqual([{ ref: "#2", blockedOn: ["#1"], link: URL163, line: 7 }]);
  });

  it("holds no rows for a section that is one line of prose", () => {
    const manifest = ok("# Fleet: github.com/org/repo\n\n## Inbox\n\nNothing waits on the operator.\n\n## In flight\n\nNothing is building.\n\n## Blocked\n\nNothing.\n\n## Landed\n\nNothing yet.\n");
    expect(manifest).toEqual({ repo: "github.com/org/repo", inbox: [], inFlight: [], blocked: [], landed: [], unreadable: [] });
  });

  it("holds no rows when the sections are absent", () => {
    expect(ok("# Fleet: gitlab.example.net/group/sub/project\n")).toEqual({ repo: "gitlab.example.net/group/sub/project", inbox: [], inFlight: [], blocked: [], landed: [], unreadable: [] });
  });

  it("contains no sections inside a fenced code block", () => {
    const manifest = ok(`# Fleet: github.com/org/repo\n\n## Notes\n\n\`\`\`\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n| #1 | x | answer | ${TIME} | ${URL163} |\n\`\`\`\n\n## Blocked\n\n~~~md\n| #1 | not a row |\n~~~\n\n| Ref | Blocked on | Link |\n| --- | --- | --- |\n| #3 | #2 | ${URL163} |\n`);
    expect(manifest.inbox).toEqual([]);
    expect(manifest.blocked).toEqual([{ ref: "#3", blockedOn: ["#2"], link: URL163, line: 21 }]);
    expect(manifest.unreadable).toEqual([]);
  });

  it("ignores every other section, even one named like a column table", () => {
    const manifest = ok(`# Fleet: github.com/org/repo\n\n## Parked\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n| junk | junk | junk | junk | junk |\n`);
    expect(manifest.inbox).toEqual([]);
    expect(manifest.unreadable).toEqual([]);
  });

  it("ends a section at a top-level heading and keeps deeper headings inside it", () => {
    const manifest = ok(`# Fleet: github.com/org/repo\n\n## Blocked\n\n### Why\n\n| Ref | Blocked on | Link |\n| --- | --- | --- |\n| #3 | #2 | ${URL163} |\n\n# Appendix\n\n| #4 | #2 | ${URL163} |\n`);
    expect(manifest.blocked).toHaveLength(1);
    expect(manifest.unreadable).toEqual([]);
  });
});

describe("parseManifest: the first line", () => {
  it.each([
    ["an empty file", ""],
    ["no heading", "github.com/org/repo\n"],
    ["a different heading", "# Manifest: github.com/org/repo\n"],
    ["the heading on the second line", "\n# Fleet: github.com/org/repo\n"],
    ["a URL", "# Fleet: https://github.com/org/repo\n"],
    ["a bare host", "# Fleet: github.com\n"],
    ["text after the repository", "# Fleet: github.com/org/repo and more\n"],
    ["no repository", "# Fleet:\n"],
  ])("is unreadable for %s", (_name, text) => {
    expect(parseManifest(text)).toMatchObject({ status: "unreadable" });
  });

  it("names the repository as parseRepo reads it", () => {
    expect(ok("# Fleet:   GitLab.Example.net/Group/Project.git  \n").repo).toBe("gitlab.example.net/Group/Project");
  });
});

describe("parseManifest: a table missing a column", () => {
  it("makes every row of the section unreadable, naming the column", () => {
    const text = `# Fleet: github.com/org/repo\n\n## Inbox\n\n| Ref | What | Waits for | Link |\n| --- | --- | --- | --- |\n| #1 | a | answer | ${URL163} |\n| #2 | b | answer | ${URL163} |\n\n## Blocked\n\n| Ref | Blocked on | Link |\n| --- | --- | --- |\n| #3 | #1 | ${URL163} |\n`;
    const manifest = ok(text);
    expect(manifest.inbox).toEqual([]);
    expect(manifest.blocked).toHaveLength(1);
    expect(manifest.unreadable).toEqual([
      { section: "Inbox", line: 7, reason: 'the table has no "Since" column' },
      { section: "Inbox", line: 8, reason: 'the table has no "Since" column' },
    ]);
  });

  it("names every missing column", () => {
    expect(failures(`${INBOX_HEAD.replace("| Ref | What | Waits for | Since | Link |", "| Ref | What | Link |").replace("| --- | --- | --- | --- | --- |", "| --- | --- | --- |")}| #1 | a | ${URL163} |\n`)[0]!.reason).toBe('the table has no "Waits for", "Since" column');
  });

  it("names one unreadable row at the header when the table has no rows", () => {
    const manifest = ok("# Fleet: github.com/org/repo\n\n## Landed\n\n| Ref | Spec |\n| --- | --- |\n");
    expect(manifest.unreadable).toEqual([{ section: "Landed", line: 5, reason: 'the table has no "Merged", "Link" column' }]);
  });

  it("names a pipe line that is no table", () => {
    const manifest = ok("# Fleet: github.com/org/repo\n\n## Landed\n\n| Ref | Spec | Merged | Link |\n");
    expect(manifest.unreadable).toEqual([{ section: "Landed", line: 5, reason: "the table has no header row with a delimiter row below it" }]);
  });
});

describe("parseManifest: row failures", () => {
  const inbox = (cells: string): string => `${INBOX_HEAD}${cells}\n`;
  const row = (overrides: Partial<Record<"ref" | "what" | "waits" | "since" | "link", string>> = {}): string => {
    const cell = { ref: "#163", what: "A question", waits: "answer", since: TIME, link: URL163, ...overrides };
    return `| ${cell.ref} | ${cell.what} | ${cell.waits} | ${cell.since} | ${cell.link} |`;
  };

  it("skips an unreadable row and counts the rest", () => {
    const manifest = ok(inbox(`${row()}\n${row({ waits: "later" })}\n${row({ ref: "#164" })}`));
    expect(manifest.inbox.map((r) => r.ref)).toEqual(["#163", "#164"]);
    expect(manifest.unreadable).toEqual([{ section: "Inbox", line: 8, reason: 'Waits for "later" is not one of answer, grant, ready, other' }]);
  });

  it.each(["163", "#", "#x1", "#1a", "ENG212", "1-2", "-", "--", "ENG-", "ENG-1a", "# 12"])("refuses the Ref %j", (ref) => {
    expect(failures(inbox(row({ ref })))).toMatchObject([{ section: "Inbox", line: 7, reason: expect.stringContaining("Ref") }]);
  });

  it.each(["#1", "!12", "ENG-212", "proj_x-9", "—"])("accepts the Ref %j", (ref) => {
    const link = ref === "—" ? "this thread, message 1, 2026-10-12T09:30:00Z" : URL163;
    expect(failures(inbox(row({ ref, link })))).toEqual([]);
  });

  it("refuses an empty What", () => {
    expect(failures(inbox(row({ what: "" })))[0]!.reason).toBe("What is empty");
  });

  it.each(["", "Answer", "answers", "answer, grant"])("refuses the Waits for %j", (waits) => {
    expect(failures(inbox(row({ waits })))[0]!.reason).toContain("Waits for");
  });

  it.each(["answer", "grant", "ready", "other"])("accepts the Waits for %s", (waits) => {
    expect(failures(inbox(row({ waits })))).toEqual([]);
  });

  it.each([
    "2026-10-12",
    "2026-10-12T09:30:00",
    "2026-10-12 09:30:00Z",
    "2026-10-12T09:30:00+0200",
    "2026-10-12T09:30:00z",
    "2026-13-12T09:30:00Z",
    "2026-02-30T09:30:00Z",
    "2025-02-29T09:30:00Z",
    "2026-10-12T24:00:00Z",
    "2026-10-12T09:60:00Z",
    "2026-10-12T09:30:61Z",
    "2026-10-12T09:30:00+24:00",
    "2026-10-12T09:30.5Z",
    "",
  ])("refuses the Since %j", (since) => {
    expect(failures(inbox(row({ since })))[0]!.reason).toContain("Since");
  });

  it.each(["2026-10-12T09:30:00+02:00", "2026-10-12T07:30:00Z", "2026-10-12T07:30Z", "2026-10-12T07:30:00.123456Z", "2024-02-29T00:00:00-05:30"])("accepts the Since %j", (since) => {
    expect(failures(inbox(row({ since })))).toEqual([]);
  });

  it.each([URL163, "http://example.net/x", "[the issue](https://github.com/org/repo/issues/1)", "<https://github.com/org/repo/issues/1>", "`https://github.com/org/repo/issues/1`", '[x](<https://github.com/org/repo/issues/1> "title")'])(
    "reads the URL in the Link cell %j",
    (link) => {
      const manifest = ok(inbox(row({ link })));
      expect(manifest.unreadable).toEqual([]);
      expect(manifest.inbox[0]!.link).toMatch(/^https?:\/\//);
    },
  );

  it.each(["", "github.com/org/repo/issues/1", "ftp://example.net/x", "javascript:alert(1)", "https://", "this thread, message 1, 2026-10-12T09:30:00Z", "thread thr_a, message 1, 2026-10-12T09:30:00Z"])(
    "refuses the Link %j on a row with a Ref",
    (link) => {
      expect(failures(inbox(row({ link })))[0]!.reason).toContain("Link");
    },
  );

  it.each([
    "this thread, message 12, 2026-10-12T09:30:00+02:00",
    "this thread, message 12, 2026-10-12T09:30:00Z",
    "thread thr_ycfbv7t94q, message 3, 2026-10-12T09:30:00Z",
    "https://github.com/org/repo/issues/1",
  ])("accepts the Link %j on a row without a Ref", (link) => {
    expect(failures(inbox(row({ ref: "—", link })))).toEqual([]);
  });

  it.each([
    "this thread",
    "this thread, message x, 2026-10-12T09:30:00Z",
    "this thread, message 12, 2026-10-12",
    "this thread, message 12, 2026-10-12T09:30:00",
    "this thread, message 12, 2026-02-30T09:30:00Z",
    "thread abc, message 3, 2026-10-12T09:30:00Z",
    "thread THR_a, message 3, 2026-10-12T09:30:00Z",
    "that thread, message 3, 2026-10-12T09:30:00Z",
    "",
  ])("refuses the Link %j on a row without a Ref", (link) => {
    expect(failures(inbox(row({ ref: "—", link })))[0]!.reason).toContain("Link");
  });

  it("names a row whose cell count differs from the header's", () => {
    const manifest = ok(inbox(`| #1 | one | answer | ${TIME} |\n| #2 | a | b | answer | ${TIME} | ${URL163} |`));
    expect(manifest.inbox).toEqual([]);
    expect(manifest.unreadable.map((u) => [u.line, u.reason])).toEqual([
      [7, "the row has 4 cells and the header names 5"],
      [8, "the row has 6 cells and the header names 5"],
    ]);
  });

  describe("In flight", () => {
    const flight = (overrides: Partial<Record<"ref" | "work" | "stage" | "since" | "builder" | "link", string>> = {}): string => {
      const cell = { ref: "#1", work: "Build it", stage: "building", since: TIME, builder: "thr_abc123", link: "https://github.com/org/repo/pull/2", ...overrides };
      return `${FLIGHT_HEAD}| ${cell.ref} | ${cell.work} | ${cell.stage} | ${cell.since} | ${cell.builder} | ${cell.link} |\n`;
    };

    it.each(["building", "asking", "waiting on you", "under review", "at the bar", "round open", "brainstorming"])("accepts the Stage %s", (stage) => {
      expect(failures(flight({ stage }))).toEqual([]);
    });

    it.each(["", "Building", "waiting", "done"])("refuses the Stage %j", (stage) => {
      expect(failures(flight({ stage }))[0]!.reason).toContain("Stage");
    });

    it.each(["thr_abc123", "—"])("accepts the Builder %s", (builder) => {
      expect(failures(flight({ builder }))).toEqual([]);
    });

    it.each(["", "abc123", "thr_", "thr_ABC", "thr_a-b", "-"])("refuses the Builder %j", (builder) => {
      expect(failures(flight({ builder }))[0]!.reason).toContain("Builder");
    });

    it("refuses an empty Work and a bad Since", () => {
      expect(failures(flight({ work: "" }))[0]!.reason).toBe("Work is empty");
      expect(failures(flight({ since: "yesterday" }))[0]!.reason).toContain("Since");
    });
  });

  describe("Blocked", () => {
    const blocked = (blockedOn: string, ref = "#9", link = URL163): string => `${BLOCKED_HEAD}| ${ref} | ${blockedOn} | ${link} |\n`;

    it("reads references separated by commas", () => {
      expect(ok(blocked("#1,ENG-2 , !3")).blocked[0]!.blockedOn).toEqual(["#1", "ENG-2", "!3"]);
    });

    it.each(["", "—", "#1,", ",#1", "#1,,#2", "#1 #2", "#1; #2", "one", "#1, —"])("refuses Blocked on %j", (blockedOn) => {
      expect(failures(blocked(blockedOn))[0]!.reason).toContain("Blocked on");
    });

    it("refuses a bad Ref or Link", () => {
      expect(failures(blocked("#1", "nine"))[0]!.reason).toContain("Ref");
      expect(failures(blocked("#1", "#9", "no link"))[0]!.reason).toContain("Link");
    });
  });

  describe("Landed", () => {
    const landed = (overrides: Partial<Record<"ref" | "spec" | "merged" | "link", string>> = {}): string => {
      const cell = { ref: "#5", spec: "Old spec", merged: TIME, link: "https://github.com/org/repo/pull/6", ...overrides };
      return `${LANDED_HEAD}| ${cell.ref} | ${cell.spec} | ${cell.merged} | ${cell.link} |\n`;
    };

    it("refuses an empty Spec, a bad Merged and a Link that is no URL", () => {
      expect(failures(landed({ spec: "" }))[0]!.reason).toBe("Spec is empty");
      expect(failures(landed({ merged: "last week" }))[0]!.reason).toContain("Merged");
      expect(failures(landed({ link: "pull 6" }))[0]!.reason).toContain("Link");
    });

    it("accepts a row without a Ref that links a message", () => {
      expect(failures(landed({ ref: "—", link: "this thread, message 2, 2026-10-12T09:30:00Z" }))).toEqual([]);
    });
  });

  it("names the first failure of a row only, in column order", () => {
    const manifest = ok(inbox(row({ ref: "nope", waits: "later", since: "never" })));
    expect(manifest.unreadable).toHaveLength(1);
    expect(manifest.unreadable[0]!.reason).toContain("Ref");
  });

  it("does not echo a long cell whole", () => {
    expect(failures(inbox(row({ waits: "x".repeat(300) })))[0]!.reason.length).toBeLessThan(120);
  });
});

describe("parseMessageLink", () => {
  it("reads the manager's own thread and another thread", () => {
    expect(parseMessageLink("this thread, message 12, 2026-10-12T07:29:00+00:00")).toEqual({ threadId: null, message: 12, at: "2026-10-12T07:29:00+00:00" });
    expect(parseMessageLink("thread thr_abc123, message 4, 2026-10-11T18:00:00-05:00")).toEqual({ threadId: "thr_abc123", message: 4, at: "2026-10-11T18:00:00-05:00" });
  });

  it("reads a URL, a bad time and other text as no message", () => {
    expect(parseMessageLink("https://github.com/org/repo/issues/1")).toBeNull();
    expect(parseMessageLink("this thread, message 1, yesterday")).toBeNull();
    expect(parseMessageLink("thread abc, message 1, 2026-10-12T07:29:00Z")).toBeNull();
  });
});

describe("writtenSections", () => {
  const FILE = `# Fleet: github.com/org/repo

Prose before any section.

## Inbox

| Ref | What | Waits for | Since | Link |
| --- | --- | --- | --- | --- |

## Backlog

- #190 Rework the cache
- #191 Docs

## In flight

Nothing here.

## Standing orders ##

\`\`\`
## Not a section
\`\`\`

Merge anything green.

# A top heading

Not part of any section.

## Set aside

- #5
`;

  it("returns every section the plugin does not read by column, in the file's order, as written", () => {
    expect(writtenSections(FILE)).toEqual([
      { heading: "Backlog", markdown: "- #190 Rework the cache\n- #191 Docs" },
      { heading: "Standing orders", markdown: "```\n## Not a section\n```\n\nMerge anything green." },
      { heading: "Set aside", markdown: "- #5" },
    ]);
  });

  it("matches a read section's heading without regard to case or spacing, and leaves its rows to the reader", () => {
    expect(writtenSections("# Fleet: github.com/org/repo\n\n##  in  FLIGHT\n\nx\n\n## Landed\n\ny\n")).toEqual([]);
  });

  it("cuts a section longer than the limit and says so", () => {
    const [section] = writtenSections(`# Fleet: github.com/org/repo\n\n## Backlog\n\n${"x".repeat(MAX_WRITTEN_CHARS + 10)}\n`);
    expect(section!.markdown.length).toBeLessThan(MAX_WRITTEN_CHARS + 10);
    expect(section!.markdown.endsWith("…")).toBe(true);
  });

  it("changes nothing in how the read sections are read", () => {
    expect(parseManifest(FILE)).toMatchObject({ status: "ok", manifest: { inbox: [], inFlight: [] } });
  });
});
