import { describe, expect, it } from "vitest";
import { rowStatus } from "@/src/core/view";
import { view } from "./model/view.test.helpers";
import { rowGlyph } from "./rowStatus";

describe("the sidebar row glyph", () => {
  it("shows the timer while a compaction is due", () => {
    expect(rowGlyph(rowStatus(view({ compactionDue: true, warmPlanned: true }))!)).toEqual({
      icon: "cache-keeper/cache-keeper",
      label: "Cache Keeper: compacting before the cache goes cold",
    });
  });

  it("shows the flame while a keep-warm is planned", () => {
    expect(rowGlyph(rowStatus(view({ warmPlanned: true }))!)).toEqual({
      icon: "cache-keeper/flame",
      label: "Cache Keeper: keeping the cache warm while it waits",
    });
  });

  it("shows nothing otherwise", () => {
    expect(rowStatus(view({}))).toBeNull();
  });
});
