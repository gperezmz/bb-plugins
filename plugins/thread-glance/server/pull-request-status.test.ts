// #330: what an answer from GitHub PR Status means for auto-settle, AC3 and AC4.
import { describe, expect, it } from "vitest";
import { CAPTURED_PULL_REQUESTS } from "../testing/github-pr-status";
import { statusOfRefusedCall, statusOfRow } from "./pull-request-status";

describe("a row", () => {
  it("reads each captured row: a merged pull request, none, a failed lookup and a workspace that is gone", () => {
    expect(statusOfRow(CAPTURED_PULL_REQUESTS.env_merged)).toEqual({
      status: { kind: "available", state: "merged", updatedAt: Date.parse("2026-10-22T19:27:07Z") },
      mismatch: null,
    });
    expect(statusOfRow(CAPTURED_PULL_REQUESTS.env_none)).toEqual({ status: { kind: "absent" }, mismatch: null });
    expect(statusOfRow(CAPTURED_PULL_REQUESTS.env_offline)).toEqual({ status: { kind: "unknown" }, mismatch: null });
    expect(statusOfRow(CAPTURED_PULL_REQUESTS.env_gone)).toEqual({ status: { kind: "gone" }, mismatch: null });
  });

  it("names where a row is out of shape, and a row left out", () => {
    expect(statusOfRow({ outcome: "available", pullRequest: { state: "landed", updatedAt: "x" } })).toEqual({
      status: { kind: "unknown" },
      mismatch: expect.stringMatching(/^pullRequest\.state: /),
    });
    expect(statusOfRow(undefined)).toEqual({ status: { kind: "unknown" }, mismatch: expect.stringMatching(/^row: /) });
  });
});

describe("a refused call", () => {
  it("is no pull request where bb lists no GitHub PR Status or a disabled one, and a failed lookup otherwise", () => {
    expect(statusOfRefusedCall(undefined)).toEqual({ kind: "absent" });
    expect(statusOfRefusedCall({ enabled: false })).toEqual({ kind: "absent" });
    expect(statusOfRefusedCall({ enabled: true })).toEqual({ kind: "unknown" });
    expect(statusOfRefusedCall(null)).toEqual({ kind: "unknown" });
  });
});
