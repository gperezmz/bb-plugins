import { afterEach, describe, expect, it } from "vitest";
import { clearFleetTabWishes, PENDING_OPEN_TTL_MS, PendingOpens, requestFleetTab, takeFleetTab } from "./pending-open";

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

describe("a pending open", () => {
  it("is replaced by a later request for the same key, and redraws whoever listens when recorded or spent", () => {
    const opens = new PendingOpens<string>();
    let calls = 0;
    opens.subscribe(() => calls++);
    opens.request("k", "a", 0);
    opens.request("k", "b", 0);
    expect(opens.peek("k", 1)).toBe("b");
    expect(opens.take("k", 1)).toBe("b");
    expect(opens.take("k", 1)).toBeNull();
    expect(calls).toBe(3);
  });

  it("waits past its lifetime while held, and lapses a lifetime after it is released", () => {
    const opens = new PendingOpens<string>();
    opens.request("k", "a", 0);
    opens.hold("k", 1);
    expect(opens.peek("k", 100 * PENDING_OPEN_TTL_MS)).toBe("a");
    opens.release("k", 100 * PENDING_OPEN_TTL_MS);
    expect(opens.peek("k", 101 * PENDING_OPEN_TTL_MS)).toBeNull();
  });

  it("holds nothing that already lapsed", () => {
    const opens = new PendingOpens<string>();
    opens.request("k", "a", 0);
    opens.hold("k", PENDING_OPEN_TTL_MS);
    expect(opens.peek("k", PENDING_OPEN_TTL_MS)).toBeNull();
  });
});
