/**
 * The "Cache Keeper" nav page: threads with compact-when-idle on, threads
 * waiting now, what was sent recently and what it cost, and 30-day totals.
 * A keep-warm sent to several threads at once is one entry; hovering its
 * cost shows how it fell between threads.
 */
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { formatSize } from "@/src/core/line";
import { ago, countsText, entryText, nextWarmText, statusText, type ThreadView } from "@/src/core/view";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useKeeperRpc, useLive, useNow } from "../api";
import { costText, formatUsd, splitText } from "../model/bar";

export function Page() {
  const rpc = useKeeperRpc();
  const now = useNow();
  const { data, error } = useLive(() => rpc.call("overview", null), [rpc]);
  const navigate = useBbNavigate();
  const open = (threadId: string) => navigate.toThread(threadId);

  if (error !== null) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (data === null) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  const { totals } = data;
  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6 text-sm">
        <header>
          <h1 className="text-lg font-semibold">Cache Keeper</h1>
          <p className="text-muted-foreground">Keeps idle Claude Code threads cheap to come back to, before their prompt cache goes cold.</p>
        </header>

        <Section title="Compact when idle">
          {data.switchedOn.length === 0 ? (
            <Empty>No thread has it on. Switch it on from the chip in a thread's composer.</Empty>
          ) : (
            <Table head={["Thread", "Line", "Now", "Status"]}>
              {data.switchedOn.map((v) => (
                <Row
                  key={v.threadId}
                  view={v}
                  onOpen={open}
                  cells={[formatSize(v.line), v.context === null ? "–" : formatSize(v.context), statusText(v, now)]}
                />
              ))}
            </Table>
          )}
        </Section>

        <Section title="Waiting on background work">
          {data.waiting.length === 0 ? (
            <Empty>No idle thread is waiting on anything.</Empty>
          ) : (
            <Table head={["Thread", "Waiting on", "Next"]}>
              {data.waiting.map((v) => (
                <Row
                  key={v.threadId}
                  view={v}
                  onOpen={open}
                  cells={[countsText(v.counts), nextWarmText(v, now)]}
                />
              ))}
            </Table>
          )}
        </Section>

        <Section title="Recent">
          {data.recent.length === 0 ? (
            <Empty>Nothing sent in the last 30 days.</Empty>
          ) : (
            <Table head={["When", "Thread", "What", "Cost"]}>
              {data.recent.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="py-1.5 pr-3 text-muted-foreground">{ago(h.at, now)}</td>
                  <td className="py-1.5 pr-3">
                    <button type="button" className="text-left hover:underline" onClick={() => open(h.threadId)}>
                      {h.title}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3">{entryText(h.kind as "compaction" | "keep-warm" | "check-in", h.record)}</td>
                  <td className="py-1.5 tabular-nums">
                    <Cost cost={costText(h.record.usd, h.record.estimated, h.kind)} split={splitText(h.record.split, (id) => data.titles[id] ?? id)} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Last 30 days">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted-foreground">Compactions</dt>
            <dd>
              {totals.compactions}, {formatUsd(totals.compactionUsd)}
            </dd>
            <dt className="text-muted-foreground">Keep-warms and check-ins</dt>
            <dd>
              {totals.keepWarms} and {totals.checkIns}, {formatUsd(totals.warmUsd)}
            </dd>
            <dt className="text-muted-foreground">Cold rewrites avoided</dt>
            <dd>{formatUsd(totals.avoidedUsd)} on first messages back</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Costs are read from transcripts at list prices; compactions are estimated, and a check-in past the cost stop shows a cold write.
          </p>
        </Section>
      </div>
    </TooltipProvider>
  );
}

/** An entry's cost, and on hover how it fell between threads, or that it is an estimate. */
function Cost({ cost, split }: { cost: { text: string; estimate: boolean }; split: string | null }) {
  const { text } = cost;
  const hover = cost.estimate ? ESTIMATE_HOVER : split;
  if (hover === null) return <>{text}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default underline decoration-dotted underline-offset-2">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hover}</TooltipContent>
    </Tooltip>
  );
}

export const ESTIMATE_HOVER = "Estimate: this turn's cost couldn't be read from the transcript";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-muted-foreground">{children}</p>;

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="text-xs text-muted-foreground">
          {head.map((h) => (
            <th key={h} className="pb-1 pr-3 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({ view, cells, onOpen }: { view: ThreadView; cells: string[]; onOpen: (id: string) => void }) {
  return (
    <tr className="border-t">
      <td className="py-1.5 pr-3">
        <button type="button" className="text-left hover:underline" onClick={() => onOpen(view.threadId)}>
          {view.title}
        </button>
      </td>
      {cells.map((c, i) => (
        <td key={i} className="py-1.5 pr-3 tabular-nums">
          {c}
        </td>
      ))}
    </tr>
  );
}
