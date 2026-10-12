import { afterEach, describe, expect, it } from "vitest";
import { clearFleetTabWishes, PENDING_OPEN_TTL_MS, requestFleetTab, takeFleetTab } from "./pending-open";

afterEach(clearFleetTabWishes);

describe("the wish to open a manager's Fleet tab", () => {
  it("is taken once, for the thread it names", () => {
    requestFleetTab("thr_a", 1_000);
    expect(takeFleetTab("thr_b", 1_001)).toBe(false);
    expect(takeFleetTab("thr_a", 1_001)).toBe(true);
    expect(takeFleetTab("thr_a", 1_002)).toBe(false);
  });

  it("lapses when the thread never mounts a chip", () => {
    requestFleetTab("thr_a", 1_000);
    expect(takeFleetTab("thr_a", 1_000 + PENDING_OPEN_TTL_MS)).toBe(false);
  });
});
