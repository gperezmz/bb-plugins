import { useDashboardApi } from "@/shared/client";
import { useLive } from "@/shared/use-live";
import { headerCount, headerCountLabel } from "./model";

/** The count of rows waiting on the operator, on the right of the Fleets page's title bar; nothing at zero. */
export function FleetsHeaderCount() {
  const api = useDashboardApi();
  const { data } = useLive(() => api.fleets(), [api]);
  const count = headerCount(data);
  if (count === null) return null;
  return (
    <span aria-label={headerCountLabel(data?.waiting ?? 0)} className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium tabular-nums text-background">
      {count}
    </span>
  );
}
