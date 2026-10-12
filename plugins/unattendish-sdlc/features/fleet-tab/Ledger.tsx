import { useState } from "react";
import type { LedgerChangeView } from "@/src/fleet/application/views";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { LiveScreen } from "@/shared/LiveScreen";
import { useLive } from "@/shared/use-live";
import { changeWhen, doneText, droppedHeading, LEDGER_FILTERS, ledgerContent, ledgerFilter, ledgerIsEmpty, wakeText, type LedgerShow } from "./model";
import { useDebounced } from "./use-debounced";

const TYPING_PAUSE_MS = 250;

/**
 * The fleet's ledger, filterable by item and by what was done. It is mounted, and so fetched, only
 * once its section is opened.
 */
export function LedgerSection({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="tab-ledger" className="flex flex-col gap-2">
      <h3 id="tab-ledger" className="text-sm font-semibold">
        <button type="button" aria-expanded={open} aria-controls="tab-ledger-body" onClick={() => setOpen(!open)} className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          Ledger {open ? "▾" : "▸"}
        </button>
      </h3>
      {open ? (
        <div id="tab-ledger-body">
          <Ledger repo={repo} />
        </div>
      ) : null}
    </section>
  );
}

function Ledger({ repo }: { repo: string }) {
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
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="What was done" className="flex flex-wrap gap-1">
          {LEDGER_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={show === filter.id}
              onClick={() => setShow(filter.id)}
              className={cn("rounded-md border border-border px-2 py-0.5 text-xs", show === filter.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-state-hover")}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <Input aria-label="Filter by item" placeholder="Filter by item, e.g. #163" value={item} onChange={(event) => setItem(event.target.value)} className="h-8 min-w-40 flex-1" />
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
                      <summary className="cursor-pointer">
                        {droppedHeading(group)}
                      </summary>
                      <div className="pl-4">
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
                      <li key={`${wake.queuedAt}:${wake.kind}`} className="text-muted-foreground">
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

function ChangeList({ changes }: { changes: readonly LedgerChangeView[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {changes.map((change, at) => (
        <li key={`${change.at}:${change.ref}:${at}`} className="flex flex-wrap gap-x-3 text-xs">
          <span className="tabular-nums text-muted-foreground">{changeWhen(change)}</span>
          <span>{change.ref}</span>
          <span>{change.kind}</span>
          <span className="text-muted-foreground">{change.actor ?? "—"}</span>
          <span>{doneText(change)}</span>
        </li>
      ))}
    </ul>
  );
}
