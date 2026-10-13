import { useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { LedgerChangeView } from "@/src/fleet/application/views";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { LINK_CLASS } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS, OUTCOME_ICONS } from "@/shared/look/icons";
import { OUTCOME_TONES, TONE_TEXT } from "@/shared/look/tones";
import { useLive } from "@/shared/use-live";
import { changeWhen, doneText, droppedHeading, LEDGER_FILTERS, ledgerContent, ledgerFilter, ledgerIsEmpty, listingText, wakeText, type LedgerShow } from "./model";
import { useDebounced } from "./use-debounced";

const TYPING_PAUSE_MS = 250;

/** The Ledger tab: the fleet's ledger, filterable by what was done and by item. It is mounted, and so fetched, only once its tab opens. */
export function Ledger({ repo }: { repo: string }) {
  const api = useDashboardApi();
  const [show, setShow] = useState<LedgerShow>("all");
  const [item, setItem] = useState("");
  const settledItem = useDebounced(item, TYPING_PAUSE_MS);
  const live = useLive(
    async () => {
      const result = await api.ledger({ repo, filter: ledgerFilter(show, settledItem) });
      if (!result.ok) throw new Error(result.reason);
      return result.ledger;
    },
    [api, repo, show, settledItem],
  );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="What was done" className="flex flex-wrap gap-1">
          {LEDGER_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={show === filter.id}
              onClick={() => setShow(filter.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                show === filter.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Glyph name={ICONS.search} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Filter by item" placeholder="Filter by item, e.g. #163" value={item} onChange={(event) => setItem(event.target.value)} className="h-8 pl-7" />
        </div>
      </div>
      <LiveScreen live={live} what="the ledger">
        {(ledger) => {
          const content = ledgerContent(ledger, show, settledItem);
          if (ledgerIsEmpty(content)) return <p className="text-muted-foreground">Nothing in the ledger matches.</p>;
          return (
            <>
              {content.changes.length > 0 ? <ChangeList changes={content.changes} /> : null}
              {content.dropped.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <div className="font-medium">Dropped, by reason</div>
                  {content.dropped.map((group) => (
                    <details key={group.reason}>
                      <summary className="cursor-pointer text-xs">
                        {droppedHeading(group)}
                      </summary>
                      <div className="pt-1">
                        <ChangeList changes={group.changes} />
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
              {content.wakes.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <div className="font-medium">Wakes</div>
                  <ul>
                    {content.wakes.map((wake) => (
                      <li key={`${wake.queuedAt}:${wake.kind}`} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Glyph name={ICONS.wake} />
                        {wakeText(wake)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          );
        }}
      </LiveScreen>
    </div>
  );
}

/** Changes as a timeline, newest first: each with its time, its Ref, kind and actor, and its outcome, marked by an icon in the outcome's colour. */
function ChangeList({ changes }: { changes: readonly LedgerChangeView[] }) {
  return (
    <ol className="ml-2 flex flex-col border-l border-border">
      {changes.map((change, at) => {
        const tone = OUTCOME_TONES[change.done];
        return (
          <li key={`${change.at}:${change.ref}:${at}`} className="relative flex flex-col py-1 pl-4 text-xs">
            <span aria-hidden className="absolute -left-2 top-1.5 flex size-4 items-center justify-center rounded-full bg-background">
              <Glyph name={OUTCOME_ICONS[change.done]} tone={tone} className="size-3" />
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums text-muted-foreground">{changeWhen(change)}</span>
              {change.listing === undefined ? (
                <>
                  {change.url !== "" ? (
                    <UrlLink href={change.url} className={LINK_CLASS}>
                      {change.ref}
                    </UrlLink>
                  ) : (
                    <span>{change.ref}</span>
                  )}
                  <span>{change.kind}</span>
                  <span className="text-muted-foreground">{change.actor ?? "—"}</span>
                </>
              ) : (
                <span>{listingText(change.listing)}</span>
              )}
            </span>
            <span className={TONE_TEXT[tone]}>{doneText(change)}</span>
          </li>
        );
      })}
    </ol>
  );
}
