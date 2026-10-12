import { describe, expect, it } from "vitest";
import { newestFirst } from "./order";

describe("newestFirst", () => {
  it("puts the later time first and keeps equal times in the order given", () => {
    const rows = [{ id: "a", at: "2026-10-12T09:00:00Z" }, { id: "b", at: "2026-10-12T11:00:00Z" }, { id: "c", at: "2026-10-12T09:00:00Z" }, { id: "d", at: "2026-10-12T10:00:00Z" }];
    expect([...rows].sort(newestFirst((row) => row.at)).map((row) => row.id)).toEqual(["b", "d", "a", "c"]);
  });
});
