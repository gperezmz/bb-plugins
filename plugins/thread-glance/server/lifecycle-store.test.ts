import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, snoozedRow, waitingSettleRow } from "../shared/lifecycle";
import { MIGRATIONS } from "./database";
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

  it("deletes a row whose marks are all gone, though it still holds attention", () => {
    const db = memoryDatabase();
    const store = createLifecycleStore(db);
    store.putMany([["a", { ...parkedRow(5), heldAttentionAt: 9 }]]);
    store.putMany([["a", { ...parkedRow(5), parkedAt: null, heldAttentionAt: 9 }]]);
    expect(store.get("a")).toBeNull();
    expect(createLifecycleStore(db).get("a")).toBeNull();
  });

  it("reads a row stored before the held-attention column was added as one with none held", () => {
    const db = memoryDatabase({ upTo: 6 });
    db.prepare("INSERT INTO thread_lifecycle (thread_id, parked_at) VALUES ('old', 5)").run();
    for (const statement of MIGRATIONS.slice(6)) db.exec(statement);
    expect(createLifecycleStore(db).get("old")).toEqual(parkedRow(5));
  });

  it("reads a row stored before the waiting-settle column was added as one with no settle waiting", () => {
    const db = memoryDatabase({ upTo: 7 });
    db.prepare("INSERT INTO thread_lifecycle (thread_id, parked_at) VALUES ('old', 5)").run();
    for (const statement of MIGRATIONS.slice(7)) db.exec(statement);
    expect(createLifecycleStore(db).get("old")).toEqual(parkedRow(5));
  });

  it("keeps a waiting settle, a row with no mark, across a reload", () => {
    const db = memoryDatabase();
    expect(createLifecycleStore(db).putMany([["t1", waitingSettleRow(7)]])).toEqual(["t1"]);
    expect(createLifecycleStore(db).get("t1")).toEqual(waitingSettleRow(7));
  });
});
