// Manual order: one list of thread ids in the plugin database's `manual_order`
// table, read into memory once and written through.
import { dedupeOrder } from "../shared/manual-order";
import type { Database } from "./database";

export interface OrderStore {
  /** The list, top first. */
  get(): readonly string[];
  /** Replaces the list; ids repeated are kept at their first place. */
  replace(threadIds: readonly string[]): void;
}

export function createOrderStore(db: Database): OrderStore {
  const select = db.prepare("SELECT thread_id FROM manual_order ORDER BY position ASC").raw(true);
  const clear = db.prepare("DELETE FROM manual_order");
  const insert = db.prepare("INSERT INTO manual_order (thread_id, position) VALUES (?, ?)");
  let order = (select.all() as [string][]).map(([threadId]) => threadId);
  const write = db.transaction((ids: string[]) => {
    clear.run();
    ids.forEach((threadId, position) => insert.run(threadId, position));
  });
  return {
    get: () => order,
    replace(threadIds) {
      const next = dedupeOrder(threadIds);
      if (next.length === order.length && next.every((threadId, index) => threadId === order[index])) return;
      write(next);
      order = next;
    },
  };
}
