// A row's Status slot, worked out for the list clock's minute.
import { lastActivityAt } from "@/shared/lifecycle";
import { statusSlot, type StatusSlot } from "../../model/status-slot";
import type { RowView } from "../../model/list-model";
import { useListStore, useMinute } from "../../store/hooks";

export function useRowStatus(row: RowView): StatusSlot {
  const store = useListStore();
  const minute = useMinute();
  const { thread } = row;
  return statusSlot({
    hasPendingInteraction: thread.hasPendingInteraction,
    queuedWork: thread.queuedWork,
    indicator: thread.indicator,
    indicatorLabel: thread.indicatorLabel,
    hasDraft: row.hasDraft,
    workingSince: store.workingSince.get(row.id),
    lastActivityAt: lastActivityAt(thread),
    now: minute * 60_000,
  });
}
