import { describe, expect, it } from "vitest";
import { parseInboxNew, toastText } from "./model";

describe("a toast for a new Inbox row", () => {
  it("names the fleet and the row", () => {
    expect(toastText({ fleet: "acme/web", ref: "ENG-212", what: "which locale wins?" })).toBe("acme/web waits on you — ENG-212 which locale wins?");
  });

  it("leaves out a Ref of —", () => {
    expect(toastText({ fleet: "acme/web", ref: "—", what: "a note" })).toBe("acme/web waits on you — a note");
  });

  it("reads the server's signal, and nothing else", () => {
    const signal = { fleet: "acme/web", ref: "#1", what: "x", rowId: "r1", waitsFor: "answer", forge: "github" };
    expect(parseInboxNew(signal)).toEqual(signal);
    expect(parseInboxNew({ fleet: "acme/web" })).toBeNull();
    expect(parseInboxNew({ ...signal, waitsFor: "lunch" })).toBeNull();
    expect(parseInboxNew(null)).toBeNull();
    expect(parseInboxNew("inbox-new")).toBeNull();
  });
});
