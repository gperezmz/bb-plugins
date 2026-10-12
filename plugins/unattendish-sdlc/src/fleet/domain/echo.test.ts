import { describe, expect, it } from "vitest";
import { classify, isMarker } from "./echo";
import type { Change } from "./model";

const marker = "🤖 unattendish agent";
const fleet = { labels: { spec: "spec", ready: "ready", inProgress: "in progress", needsInput: "needs input" }, marker, echoActors: ["fleet-bot"] };
const change = (over: Partial<Change> = {}): Change => ({
  key: "k",
  role: "forge",
  ref: "#1",
  url: "https://github.com/org/repo/issues/1",
  kind: "commented",
  label: null,
  actor: "alice",
  at: "2026-10-12T01:00:00.000Z",
  lastLine: null,
  ...over,
});

describe("isMarker", () => {
  it("matches the marker bare or wrapped in kbd, with whitespace around", () => {
    for (const line of [marker, `<kbd>${marker}</kbd>`, `  <kbd>${marker}</kbd>  `, `<kbd> ${marker} </kbd>`, `<KBD>${marker}</KBD>`]) expect(isMarker(line, marker)).toBe(true);
  });
  it("takes the last non-blank line", () => {
    expect(isMarker(`Round closed.\n\n---\n<kbd>${marker}</kbd>\n\n  \n`, marker)).toBe(true);
    expect(isMarker(`<kbd>${marker}</kbd>\nAnswer: yes`, marker)).toBe(false);
  });
  it("is not a quote-reply whose quote holds the marker", () => {
    expect(isMarker(`> <kbd>${marker}</kbd>\n\nGo with option two`, marker)).toBe(false);
    expect(isMarker(`> <kbd>${marker}</kbd>`, marker)).toBe(false);
  });
  it("compares exactly", () => {
    expect(isMarker(`${marker}!`, marker)).toBe(false);
    expect(isMarker("🤖 Unattendish agent", marker)).toBe(false);
    expect(isMarker(`see <kbd>${marker}</kbd> here`, marker)).toBe(false);
  });
  it("is false for no line, a blank line, or an empty marker", () => {
    expect(isMarker(null, marker)).toBe(false);
    expect(isMarker("  \n ", marker)).toBe(false);
    expect(isMarker("", "")).toBe(false);
  });
  it("accepts a marker registered with its own wrapper", () => {
    expect(isMarker(marker, `<kbd>${marker}</kbd>`)).toBe(true);
  });
});

describe("classify", () => {
  it("drops a comment or review ending in the marker as an echo: marker", () => {
    for (const kind of ["commented", "reviewed: approved", "reviewed: changes requested", "reviewed: commented"] as const) {
      expect(classify(change({ kind, lastLine: `<kbd>${marker}</kbd>` }), fleet)).toEqual({ kind: "echo", rule: "marker" });
    }
  });
  it("does not read the marker on any other kind of change", () => {
    expect(classify(change({ kind: "closed", lastLine: marker }), fleet)).toEqual({ kind: "wake" });
  });
  it("drops a change of the in-progress or needs-input label as an echo: label", () => {
    for (const kind of ["labelled", "unlabelled"] as const) {
      for (const label of ["in progress", "needs input"]) expect(classify(change({ kind, label }), fleet)).toEqual({ kind: "echo", rule: "label" });
    }
  });
  it("wakes on the spec and ready labels", () => {
    for (const label of ["spec", "ready"]) expect(classify(change({ kind: "labelled", label }), fleet)).toEqual({ kind: "wake" });
  });
  it("drops any change by an echo actor, whatever its case", () => {
    expect(classify(change({ kind: "merged", actor: "Fleet-Bot" }), fleet)).toEqual({ kind: "echo", rule: "echo actor" });
    expect(classify(change({ kind: "labelled", label: "ready", actor: "fleet-bot" }), fleet)).toEqual({ kind: "echo", rule: "echo actor" });
  });
  it("drops a change when any other name the service knows its actor by is an echo actor", () => {
    expect(classify(change({ actor: "Display Name", actorAliases: ["bot@example.com", "Fleet-Bot"] }), fleet)).toEqual({ kind: "echo", rule: "echo actor" });
    expect(classify(change({ actor: null, actorAliases: ["fleet-bot"] }), fleet)).toEqual({ kind: "echo", rule: "echo actor" });
    expect(classify(change({ actor: "alice", actorAliases: ["alice@example.com"] }), fleet)).toEqual({ kind: "wake" });
    expect(classify(change({ actor: "alice", actorAliases: [] }), fleet)).toEqual({ kind: "wake" });
  });
  it("names the marker rule before the echo actor rule", () => {
    expect(classify(change({ actor: "fleet-bot", lastLine: marker }), fleet)).toEqual({ kind: "echo", rule: "marker" });
  });
  it("wakes on the operator's own comment, with or without a quoted marker", () => {
    expect(classify(change({ actor: "operator", lastLine: "ok" }), { ...fleet, echoActors: [] })).toEqual({ kind: "wake" });
    expect(classify(change({ actor: "operator", lastLine: "Answer: two" }), fleet)).toEqual({ kind: "wake" });
  });
  it("wakes on a change with no actor", () => {
    expect(classify(change({ kind: "closed", actor: null }), fleet)).toEqual({ kind: "wake" });
  });
});
