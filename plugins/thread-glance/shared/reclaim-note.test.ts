import { describe, expect, it } from "vitest";
import { addReclaim, EMPTY_RECLAIM, reclaimNote } from "./reclaim-note";

describe("reclaimNote", () => {
  it("joins what happened with a middle dot", () => {
    expect(reclaimNote({ stoppedRuntime: true, closedTerminals: 1, keptTerminals: 1 })).toBe(
      "Agent session stopped · closed 1 terminal nobody used · 1 terminal left running",
    );
  });

  it("pluralises and leaves out what did not happen", () => {
    expect(reclaimNote({ stoppedRuntime: false, closedTerminals: 2, keptTerminals: 3 })).toBe(
      "closed 2 terminals nobody used · 3 terminals left running",
    );
    expect(reclaimNote({ stoppedRuntime: true, closedTerminals: 0, keptTerminals: 0 })).toBe("Agent session stopped");
  });

  it("is null when nothing was reclaimed", () => {
    expect(reclaimNote(EMPTY_RECLAIM)).toBeNull();
  });

  it("adds reports", () => {
    expect(
      addReclaim(
        { stoppedRuntime: false, closedTerminals: 1, keptTerminals: 0 },
        { stoppedRuntime: true, closedTerminals: 2, keptTerminals: 1 },
      ),
    ).toEqual({ stoppedRuntime: true, closedTerminals: 3, keptTerminals: 1 });
  });
});
