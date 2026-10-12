import { describe, expect, it } from "vitest";
import { inboxRowId, offerFor, parseLink, uniqueRowIds } from "./inbox";
import type { InboxRow } from "./model";

const row = (over: Partial<InboxRow> = {}): InboxRow => ({ ref: "#163", what: "Which cache?", waitsFor: "answer", since: "2026-10-12T09:30:00Z", link: "https://github.com/org/repo/issues/163", ...over });

describe("inboxRowId", () => {
  it("is the same for the same row on every read, and does not depend on the line or the words of What", () => {
    expect(inboxRowId(row({ line: 5 }))).toBe(inboxRowId(row({ line: 9, what: "Reworded" })));
  });

  it("differs when the Ref, what it waits for or when it began differ", () => {
    const ids = new Set([row(), row({ ref: "#164" }), row({ waitsFor: "grant" }), row({ since: "2026-10-12T09:31:00Z" })].map(inboxRowId));
    expect(ids.size).toBe(4);
  });

  it("tells rows with no Ref apart by their Link", () => {
    const a = row({ ref: "—", waitsFor: "grant", link: "this thread, message 3, 2026-10-12T09:00:00Z" });
    const b = row({ ref: "—", waitsFor: "grant", link: "this thread, message 4, 2026-10-12T09:00:00Z" });
    expect(inboxRowId(a)).not.toBe(inboxRowId(b));
  });

  it("does not use the Link of a row that has a Ref", () => {
    expect(inboxRowId(row({ link: "https://github.com/org/repo/pull/9" }))).toBe(inboxRowId(row()));
  });
});

describe("uniqueRowIds", () => {
  it("keeps the ids of distinct rows and numbers a repeat", () => {
    expect(uniqueRowIds([row(), row({ ref: "#2" }), row(), row()])).toEqual(["#163|answer|2026-10-12T09:30:00Z", "#2|answer|2026-10-12T09:30:00Z", "#163|answer|2026-10-12T09:30:00Z~2", "#163|answer|2026-10-12T09:30:00Z~3"]);
  });
});

describe("parseLink", () => {
  it("reads a URL with its host and path as text", () => {
    expect(parseLink("https://github.com/org/repo/issues/163?x=1")).toEqual({ kind: "url", url: "https://github.com/org/repo/issues/163?x=1", text: "github.com/org/repo/issues/163" });
  });

  it("reads the message forms", () => {
    expect(parseLink("this thread, message 3, 2026-10-12T09:00:00Z")).toEqual({ kind: "message", message: { threadId: null, message: 3, at: "2026-10-12T09:00:00Z" } });
    expect(parseLink("thread thr_old1, message 7, 2026-10-12T09:00:00Z")).toEqual({ kind: "message", message: { threadId: "thr_old1", message: 7, at: "2026-10-12T09:00:00Z" } });
  });
});

describe("offerFor", () => {
  const link = "this thread, message 3, 2026-10-12T09:00:00Z";
  it("offers Answer…, Grant… and Build it by what the row waits for, and nothing for other", () => {
    expect(offerFor(row({ waitsFor: "answer" }), "thr_m")).toEqual({ kind: "answer", label: "Answer…", regrant: false });
    expect(offerFor(row({ waitsFor: "grant" }), "thr_m")).toEqual({ kind: "grant", label: "Grant…", regrant: false });
    expect(offerFor(row({ waitsFor: "ready" }), "thr_m")).toEqual({ kind: "build", label: "Build it", regrant: false });
    expect(offerFor(row({ waitsFor: "other" }), "thr_m")).toBeNull();
  });

  it("offers Re-grant on a grant whose Link names a previous manager's message", () => {
    expect(offerFor(row({ ref: "—", waitsFor: "grant", link: "thread thr_old1, message 7, 2026-10-12T09:00:00Z" }), "thr_m")).toMatchObject({ kind: "grant", regrant: true });
  });

  it("does not offer Re-grant on the manager's own message, by either form", () => {
    expect(offerFor(row({ ref: "—", waitsFor: "grant", link }), "thr_m")!.regrant).toBe(false);
    expect(offerFor(row({ ref: "—", waitsFor: "grant", link: "thread thr_m, message 7, 2026-10-12T09:00:00Z" }), "thr_m")!.regrant).toBe(false);
  });

  it("does not offer Re-grant on an answer row that names a message", () => {
    expect(offerFor(row({ ref: "—", waitsFor: "answer", link: "thread thr_old1, message 7, 2026-10-12T09:00:00Z" }), "thr_m")!.regrant).toBe(false);
  });
});
