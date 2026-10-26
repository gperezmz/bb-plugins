// A row's Status slot, worked out at the list clock's time.
import { lastActivityAt } from "@/shared/lifecycle";
import { statusSlot, type StatusSlot } from "../../model/status-slot";
import type { RowView } from "../../model/list-model";
import { useListStore, useNow } from "../../store/hooks";

/**
 * `withRowStatus` lets a status another plugin set on the row into the slot; a
 * slim row and a child row leave it out.
 */
export function useRowStatus(row: RowView, withRowStatus: boolean = row.card !== "slim"): StatusSlot {
  const store = useListStore();
  const now = useNow();
  const { thread } = row;
  return statusSlot({
    hasPendingInteraction: thread.hasPendingInteraction,
    queuedWork: thread.queuedWork,
    indicator: thread.indicator,
    indicatorLabel: thread.indicatorLabel,
    hasDraft: row.hasDraft,
    rowStatus: withRowStatus ? row.rowStatus : null,
    workingSince: store.workingSince.get(row.id),
    lastActivityAt: lastActivityAt(thread),
    now,
  });
}
