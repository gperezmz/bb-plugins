import { describe, expect, it } from "vitest";
import { linkTarget } from "./links";

describe("a row's link", () => {
  it("goes to the item's URL", () => {
    expect(linkTarget({ kind: "url", url: "https://example.test/1", text: "#1" }, "thr_m")).toEqual({ kind: "url", url: "https://example.test/1", text: "#1" });
  });

  it("opens the manager's own thread for a message in this thread", () => {
    expect(linkTarget({ kind: "message", message: { threadId: null, message: 3, at: "2026-10-12T01:00:00Z" } }, "thr_m")).toEqual({ kind: "thread", threadId: "thr_m", text: "message 3" });
  });

  it("opens the previous manager's thread when the message names one", () => {
    expect(linkTarget({ kind: "message", message: { threadId: "thr_old", message: 3, at: "2026-10-12T01:00:00Z" } }, "thr_m")).toMatchObject({ threadId: "thr_old" });
  });
});
