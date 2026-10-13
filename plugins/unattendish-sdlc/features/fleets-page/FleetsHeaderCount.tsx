import { useDashboardApi } from "@/shared/client";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { Tip } from "@/shared/look/Tip";
import { refetchEveryView, useLive } from "@/shared/use-live";
import { headerCount, headerCountLabel, staleText } from "./model";

/**
 * The right of the Fleets page's title bar: the count of Inbox rows across fleets, nothing at zero, and, while a
 * refresh has failed over data still shown, an amber pill saying how old that data is, with a button that reloads the
 * title bar and the page together.
 */
export function FleetsHeaderCount() {
  const api = useDashboardApi();
  const live = useLive(() => api.fleets(), [api]);
  const { data, error } = live;
  const count = headerCount(data);
  const stale = data !== null && error !== null ? staleText(data.generatedAt, error, Date.now()) : null;
  return (
    <span className="flex items-center gap-2">
      {stale !== null ? (
        <Tip text={stale.hover}>
          <span tabIndex={0} aria-label={stale.hover} className="flex items-center gap-1 rounded-full border border-warning px-2 py-0.5 text-xs text-warning-text">
            {stale.pill}
            <button type="button" aria-label="Reload now" className="rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => void refetchEveryView()}>
              <Glyph name={ICONS.reload} className="size-3" />
            </button>
          </span>
        </Tip>
      ) : null}
      {count !== null ? (
        <span aria-label={headerCountLabel(data?.waiting ?? 0)} className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium tabular-nums text-background">
          {count}
        </span>
      ) : null}
    </span>
  );
}
