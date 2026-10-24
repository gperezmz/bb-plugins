import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, snoozedRow } from "../shared/lifecycle";
import { createLifecycleStore } from "./lifecycle-store";
import { memoryDatabase } from "./testing/fakes";

describe("the lifecycle store", () => {
  it("reads back from the database what it wrote, the held attention included", () => {
    const db = memoryDatabase();
    const rows = {
      parked: { ...parkedRow(5), heldAttentionAt: 9 },
      snoozed: { ...snoozedRow(50, 6), heldAttentionAt: 10 },
      settled: settledRow(7, "auto"),
    };
    const store = createLifecycleStore(db);
    store.putMany(Object.entries(rows));
    const reopened = createLifecycleStore(db);
    for (const [threadId, row] of Object.entries(rows)) expect(reopened.get(threadId)).toEqual(row);
  });

  it("drops the held attention with the last mark of a row", () => {
    const db = memoryDatabase();
    const store = createLifecycleStore(db);
    store.putMany([["a", { ...parkedRow(5), heldAttentionAt: 9 }]]);
    store.putMany([["a", null]]);
    expect(createLifecycleStore(db).get("a")).toBeNull();
  });
});
