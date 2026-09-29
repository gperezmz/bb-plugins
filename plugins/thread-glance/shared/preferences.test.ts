import { describe, expect, it } from "vitest";
import { parseClientPreferences } from "./preferences";

describe("per-device preferences", () => {
  it("opens a device that saved neither with Compact and Branch line off", () => {
    expect(parseClientPreferences(null)).toEqual({ density: "compact", branchLine: false });
    expect(parseClientPreferences({})).toEqual({ density: "compact", branchLine: false });
  });
  it("carries a density saved by 0.5.0 or earlier over, with Branch line on only for Comfortable", () => {
    expect(parseClientPreferences({ density: "comfortable" })).toEqual({ density: "comfortable", branchLine: true });
    expect(parseClientPreferences({ density: "compact" })).toEqual({ density: "compact", branchLine: false });
  });
  it("keeps a saved Branch line choice whatever the density", () => {
    expect(parseClientPreferences({ density: "comfortable", branchLine: false })).toEqual({ density: "comfortable", branchLine: false });
    expect(parseClientPreferences({ density: "compact", branchLine: true })).toEqual({ density: "compact", branchLine: true });
  });
  it("reads an unreadable value as never saved", () => {
    expect(parseClientPreferences({ density: "cosy", branchLine: "yes" })).toEqual({ density: "compact", branchLine: false });
    expect(parseClientPreferences("junk")).toEqual({ density: "compact", branchLine: false });
  });
});
