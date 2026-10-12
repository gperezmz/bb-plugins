// The manifest as the plugin reads it: the first line names the repository,
// four sections hold GitHub-flavoured pipe tables read by column name, and
// every other section is shown as written and read by nobody here. A row that
// breaks the contract is skipped and named; the rows around it still count.
import { formatRepo, parseRepo } from "./identity";
import type { BlockedRow, InboxRow, InFlightRow, LandedRow, Manifest, ManifestRead, Stage, UnreadableRow, WaitsFor, WrittenSection } from "./model";

const WAITS_FOR: readonly WaitsFor[] = ["answer", "grant", "ready", "other"];
const STAGES: readonly Stage[] = ["building", "asking", "waiting on you", "under review", "at the bar", "round open", "brainstorming"];

/** The Ref and Builder cells' stand-in for "none". */
const NONE = "—";

const REFERENCE = /^(?:#\d+|!\d+|[A-Za-z][A-Za-z0-9_]*-\d+)$/;
const THREAD_ID = /^thr_[a-z0-9]+$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const MESSAGE = String.raw`message (\d+), (\S+)`;
const OWN_THREAD_LINK = new RegExp(`^this thread, ${MESSAGE}$`);
const OTHER_THREAD_LINK = new RegExp(`^thread (thr_[a-z0-9]+), ${MESSAGE}$`);

type Cells = Readonly<Record<string, string>>;
type Reading<Row> = Omit<Row, "line"> | string;

interface SectionSpec<Row extends { readonly line?: number }> {
  readonly heading: string;
  readonly columns: readonly string[];
  /** The row the cells make, or why they do not make one. */
  readonly read: (cells: Cells) => Reading<Row>;
}

/** The first failure among checks given in column order; null when every check passed. */
const firstFailure = (...failures: readonly (string | null)[]): string | null => failures.find((failure) => failure !== null) ?? null;

const clip = (value: string): string => (value.length > 60 ? `${value.slice(0, 57)}...` : value);

const isReference = (value: string): boolean => REFERENCE.test(value);

const refFailure = (value: string): string | null => (value === NONE || isReference(value) ? null : `Ref "${clip(value)}" is not #<n>, !<n>, a tracker key or ${NONE}`);

const textFailure = (column: string, value: string): string | null => (value === "" ? `${column} is empty` : null);

const oneOfFailure = (column: string, value: string, allowed: readonly string[]): string | null =>
  allowed.includes(value) ? null : `${column} "${clip(value)}" is not one of ${allowed.join(", ")}`;

const daysIn = (year: number, month: number): number => (month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** Whether the text is an ISO 8601 date and time with an offset (`Z` counts) naming a real moment. */
const isTimeWithOffset = (value: string): boolean => {
  const match = TIME.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part))) as [number, number, number, number, number, number, number, number];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month) && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
};

const timeFailure = (column: string, value: string): string | null => (isTimeWithOffset(value) ? null : `${column} "${clip(value)}" is not an ISO 8601 time with an offset`);

const builderFailure = (value: string): string | null => (value === NONE || THREAD_ID.test(value) ? null : `Builder "${clip(value)}" is not a bb thread id or ${NONE}`);

const isHttpUrl = (value: string): boolean => {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
};

/** The message a Link names in a bb thread, the form a row with no Ref carries; `threadId` is null for the manager's own thread. Null for any other Link. */
export const parseMessageLink = (value: string): { readonly threadId: string | null; readonly message: number; readonly at: string } | null => {
  const own = OWN_THREAD_LINK.exec(value);
  const other = own === null ? OTHER_THREAD_LINK.exec(value) : null;
  const match = own ?? other;
  if (match === null) return null;
  const at = match[match.length - 1]!;
  if (!isTimeWithOffset(at)) return null;
  return { threadId: other === null ? null : other[1]!, message: Number(match[match.length - 2]), at };
};

const isMessageLink = (value: string): boolean => parseMessageLink(value) !== null;

const linkFailure = (ref: string, value: string): string | null => {
  if (isHttpUrl(value)) return null;
  if (ref === NONE) return isMessageLink(value) ? null : `Link "${clip(value)}" is not an http(s) URL, "this thread, message <n>, <time>" or "thread <id>, message <n>, <time>"`;
  return `Link "${clip(value)}" is not an http(s) URL, which a row with a Ref must carry`;
};

const blockedOnFailure = (value: string): string | null => {
  const references = value.split(",").map((part) => part.trim());
  return references.every(isReference) ? null : `Blocked on "${clip(value)}" is not references separated by commas`;
};

const readInbox = (c: Cells): Reading<InboxRow> =>
  firstFailure(refFailure(c.Ref!), textFailure("What", c.What!), oneOfFailure("Waits for", c["Waits for"]!, WAITS_FOR), timeFailure("Since", c.Since!), linkFailure(c.Ref!, c.Link!)) ?? {
    ref: c.Ref!,
    what: c.What!,
    waitsFor: c["Waits for"]! as WaitsFor,
    since: c.Since!,
    link: c.Link!,
  };

const readInFlight = (c: Cells): Reading<InFlightRow> =>
  firstFailure(refFailure(c.Ref!), textFailure("Work", c.Work!), oneOfFailure("Stage", c.Stage!, STAGES), timeFailure("Since", c.Since!), builderFailure(c.Builder!), linkFailure(c.Ref!, c.Link!)) ?? {
    ref: c.Ref!,
    work: c.Work!,
    stage: c.Stage! as Stage,
    since: c.Since!,
    builder: c.Builder!,
    link: c.Link!,
  };

const readBlocked = (c: Cells): Reading<BlockedRow> =>
  firstFailure(refFailure(c.Ref!), blockedOnFailure(c["Blocked on"]!), linkFailure(c.Ref!, c.Link!)) ?? {
    ref: c.Ref!,
    blockedOn: c["Blocked on"]!.split(",").map((part) => part.trim()),
    link: c.Link!,
  };

const readLanded = (c: Cells): Reading<LandedRow> =>
  firstFailure(refFailure(c.Ref!), textFailure("Spec", c.Spec!), timeFailure("Merged", c.Merged!), linkFailure(c.Ref!, c.Link!)) ?? {
    ref: c.Ref!,
    spec: c.Spec!,
    merged: c.Merged!,
    link: c.Link!,
  };

const INBOX: SectionSpec<InboxRow> = { heading: "Inbox", columns: ["Ref", "What", "Waits for", "Since", "Link"], read: readInbox };
const IN_FLIGHT: SectionSpec<InFlightRow> = { heading: "In flight", columns: ["Ref", "Work", "Stage", "Since", "Builder", "Link"], read: readInFlight };
const BLOCKED: SectionSpec<BlockedRow> = { heading: "Blocked", columns: ["Ref", "Blocked on", "Link"], read: readBlocked };
const LANDED: SectionSpec<LandedRow> = { heading: "Landed", columns: ["Ref", "Spec", "Merged", "Link"], read: readLanded };

// ---- Markdown ----

interface Line {
  readonly no: number;
  readonly text: string;
}

const FIRST_LINE = /^# Fleet:(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^:?-+:?$/;

const normal = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/** A table row's cells: the outer pipes dropped, `\|` read as a pipe in the text, each cell trimmed. */
const splitRow = (line: string): string[] => {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells: string[] = [];
  let cell = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "\\" && text[at + 1] === "|") {
      cell += "|";
      at += 1;
    } else if (char === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || cells.length === 0) cells.push(cell);
  return cells.map((part) => part.trim());
};

const isDelimiterRow = (text: string): boolean => text.includes("|") && splitRow(text).every((cell) => DELIMITER_CELL.test(cell));

/** A Link cell without the Markdown around the URL: backticks, `[text](url)` and `<url>`. */
const unwrapLink = (cell: string): string => {
  let value = cell;
  for (let pass = 0; pass < 3; pass += 1) {
    const code = /^`+(.+?)`+$/.exec(value);
    const link = /^\[[^\]]*\]\(\s*<?([^\s>)]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(value);
    const angle = /^<([^<>\s]+)>$/.exec(value);
    const next = (code ?? link ?? angle)?.[1]?.trim();
    if (next === undefined || next === value) break;
    value = next;
  }
  return value;
};

interface Section {
  readonly name: string;
  readonly lines: readonly Line[];
}

/** The `##` sections of the file, in order, as the lines each holds; a fenced code block's lines read as blank so nothing inside it is a heading or a row. */
const sectionsOf = (lines: readonly string[]): Section[] => {
  const sections: { name: string; lines: Line[] }[] = [];
  let current: { name: string; lines: Line[] } | null = null;
  let fence: string | null = null;
  lines.forEach((text, index) => {
    const no = index + 1;
    if (index === 0) return;
    const opening = FENCE.exec(text);
    if (fence !== null) {
      if (opening !== null && opening[1]![0] === fence[0] && opening[1]!.length >= fence.length && text.trim() === opening[1]) fence = null;
      current?.lines.push({ no, text: "" });
      return;
    }
    if (opening !== null) {
      fence = opening[1]!;
      current?.lines.push({ no, text: "" });
      return;
    }
    const heading = HEADING.exec(text);
    if (heading !== null && heading[1]!.length <= 2) {
      current = heading[1]!.length === 2 ? { name: normal(heading[2]!), lines: [] } : null;
      if (current !== null) sections.push(current);
      return;
    }
    current?.lines.push({ no, text });
  });
  return sections;
};

/** Reads one section's table into `rows`, naming into `unreadable` each row it cannot read. */
const readTable = <Row extends { readonly line?: number }>(spec: SectionSpec<Row>, lines: readonly Line[], rows: Row[], unreadable: UnreadableRow[]): void => {
  const fail = (line: number, reason: string): void => void unreadable.push({ section: spec.heading, line, reason });
  const header = lines.findIndex((line, at) => line.text.includes("|") && lines[at + 1] !== undefined && isDelimiterRow(lines[at + 1]!.text));
  if (header === -1) {
    const stray = lines.find((line) => line.text.trim().startsWith("|"));
    if (stray !== undefined) fail(stray.no, "the table has no header row with a delimiter row below it");
    return;
  }
  const names = splitRow(lines[header]!.text).map(normal);
  const body: Line[] = [];
  for (const line of lines.slice(header + 2)) {
    if (line.text.trim() === "" || HEADING.test(line.text)) break;
    body.push(line);
  }
  const missing = spec.columns.filter((column) => !names.includes(normal(column)));
  if (missing.length > 0) {
    const reason = `the table has no ${missing.map((column) => `"${column}"`).join(", ")} column`;
    if (body.length === 0) fail(lines[header]!.no, reason);
    for (const line of body) fail(line.no, reason);
    return;
  }
  for (const line of body) {
    const values = splitRow(line.text);
    if (values.length !== names.length) {
      fail(line.no, `the row has ${values.length} cells and the header names ${names.length}`);
      continue;
    }
    const cells: Record<string, string> = {};
    for (const column of spec.columns) cells[column] = values[names.indexOf(normal(column))]!;
    cells.Link = unwrapLink(cells.Link!);
    const read = spec.read(cells);
    if (typeof read === "string") fail(line.no, read);
    else rows.push({ ...read, line: line.no } as Row);
  }
};

/** `unreadable` when the first line is not `# Fleet: <host>/<path>` naming a repository `parseRepo` reads; else `ok`. Never `missing` (the caller finds that out). */
export function parseManifest(text: string): ManifestRead {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const first = FIRST_LINE.exec(lines[0] ?? "");
  const repo = first === null ? null : parseRepo(first[1]!);
  if (repo === null) return { status: "unreadable", reason: "the first line is not `# Fleet: <host>/<path>` naming a repository" };
  const inbox: InboxRow[] = [];
  const inFlight: InFlightRow[] = [];
  const blocked: BlockedRow[] = [];
  const landed: LandedRow[] = [];
  const unreadable: UnreadableRow[] = [];
  for (const section of sectionsOf(lines)) {
    if (section.name === normal(INBOX.heading)) readTable(INBOX, section.lines, inbox, unreadable);
    else if (section.name === normal(IN_FLIGHT.heading)) readTable(IN_FLIGHT, section.lines, inFlight, unreadable);
    else if (section.name === normal(BLOCKED.heading)) readTable(BLOCKED, section.lines, blocked, unreadable);
    else if (section.name === normal(LANDED.heading)) readTable(LANDED, section.lines, landed, unreadable);
  }
  return { status: "ok", manifest: { repo: formatRepo(repo), inbox, inFlight, blocked, landed, unreadable } satisfies Manifest };
}

/** The longest a written section's Markdown is kept; a longer one is cut and says so. */
export const MAX_WRITTEN_CHARS = 100_000;

const READ_HEADINGS: ReadonlySet<string> = new Set([INBOX, IN_FLIGHT, BLOCKED, LANDED].map((spec) => normal(spec.heading)));

/**
 * Every `##` section of the file the plugin does not read by column (Backlog, Set aside, Standing orders, any other),
 * in the file's order, each with its heading and Markdown as written. A fenced code block may hold a `##` line that
 * starts no section. The text of the first line and of anything under a `#` heading belongs to no section.
 */
export function writtenSections(text: string): WrittenSection[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const found: { heading: string; name: string; body: string[] }[] = [];
  let current: (typeof found)[number] | null = null;
  let fence: string | null = null;
  lines.forEach((line, index) => {
    if (index === 0) return;
    const opening = FENCE.exec(line);
    if (fence !== null) {
      if (opening !== null && opening[1]![0] === fence[0] && opening[1]!.length >= fence.length && line.trim() === opening[1]) fence = null;
      current?.body.push(line);
      return;
    }
    if (opening !== null) {
      fence = opening[1]!;
      current?.body.push(line);
      return;
    }
    const heading = HEADING.exec(line);
    if (heading !== null && heading[1]!.length <= 2) {
      current = heading[1]!.length === 2 ? { heading: heading[2]!.trim(), name: normal(heading[2]!), body: [] } : null;
      if (current !== null) found.push(current);
      return;
    }
    current?.body.push(line);
  });
  return found
    .filter((section) => !READ_HEADINGS.has(section.name))
    .map((section) => {
      const markdown = section.body.join("\n").trim();
      return { heading: section.heading, markdown: markdown.length > MAX_WRITTEN_CHARS ? `${markdown.slice(0, MAX_WRITTEN_CHARS)}\n\n…` : markdown };
    });
}
