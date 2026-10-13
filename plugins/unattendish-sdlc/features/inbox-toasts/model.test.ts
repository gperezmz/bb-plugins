import { describe, expect, it } from "vitest";
import { parseInboxNew, toastId, toastLine, toastTitle } from "./model";

describe("a toast for a new Inbox row", () => {
  it("is titled by the item's ref and title, with the fleet and what it waits for under it", () => {
    expect(toastTitle({ ref: "#7", what: "Which cache to use" })).toBe("#7 Which cache to use");
    expect(toastLine({ fleet: "org/dash", waitsFor: "answer" })).toBe("org/dash waits for your answer");
    expect(toastLine({ fleet: "org/dash", waitsFor: "grant" })).toBe("org/dash waits for a grant to merge");
    expect(toastLine({ fleet: "org/dash", waitsFor: "ready" })).toBe("org/dash waits for your ready label");
    expect(toastLine({ fleet: "org/dash", waitsFor: "other" })).toBe("org/dash waits for something else");
  });

  it("leaves out a Ref of —", () => {
    expect(toastTitle({ ref: "—", what: "a note" })).toBe("a note");
  });

  it("reads the server's signal, and nothing else", () => {
    const signal = { fleet: "acme/web", ref: "#1", what: "x", rowId: "r1", waitsFor: "answer", forge: "github" };
    expect(parseInboxNew(signal)).toEqual(signal);
    expect(parseInboxNew({ fleet: "acme/web" })).toBeNull();
    expect(parseInboxNew({ ...signal, waitsFor: "lunch" })).toBeNull();
    expect(parseInboxNew(null)).toBeNull();
    expect(parseInboxNew("inbox-new")).toBeNull();
  });

  it("is identified by its fleet and its row, so two fleets' rows with the same id are two toasts", () => {
    expect(toastId({ fleet: "org/a", rowId: "#7|answer|t" })).toBe(toastId({ fleet: "org/a", rowId: "#7|answer|t" }));
    expect(toastId({ fleet: "org/a", rowId: "#7|answer|t" })).not.toBe(toastId({ fleet: "org/b", rowId: "#7|answer|t" }));
  });
});
