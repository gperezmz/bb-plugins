/**
 * The chip's popover: the switch, the sentence, the context bar with the
 * line's handle, the status line, what the line rests on, and a folded
 * "Why {line}?" with the dollar figures.
 */
import { formatSize, lineWhy } from "@/src/core/line";
import { popoverSentence, statusText, type ThreadView } from "@/src/core/view";
import { useAction, useKeeperRpc } from "../api";
import { formatUsd } from "../model/bar";
import { ContextBar } from "./ContextBar";

export function CompactPopover({ view, now, onChange }: { view: ThreadView; now: number; onChange: (next: ThreadView | null) => void }) {
  const rpc = useKeeperRpc();
  const { run, error } = useAction(onChange);
  const line = formatSize(view.line);
  const lifetime = view.lifetime === null ? "cache lifetime not read yet" : view.lifetime === "5m" ? "5 min cache" : "1 h cache";

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-3 font-medium">
        <span id={`${view.threadId}-compact-label`}>Compact when idle</span>
        {/* A button rather than a native checkbox: bb's composer reverts a checkbox toggled inside it. */}
        <button
          type="button"
          role="switch"
          aria-checked={view.compactOn}
          aria-labelledby={`${view.threadId}-compact-label`}
          onClick={() => void run(rpc.call("setCompact", { threadId: view.threadId, on: !view.compactOn }))}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${view.compactOn ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute left-0 top-0.5 size-4 rounded-full bg-background shadow transition-transform ${view.compactOn ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
      </div>
      <p className="text-muted-foreground">{popoverSentence(view)}</p>
      <ContextBar view={view} onSetting={(setting) => void run(rpc.call("setSetting", { threadId: view.threadId, setting }))} />
      <p className="tabular-nums">
        now {view.context === null ? "unknown" : formatSize(view.context)} · {statusText(view, now)}
      </p>
      <p className="text-xs text-muted-foreground">
        {view.model ?? "Model not read yet"} · {lifetime} · {view.callsPerMessage.toFixed(1)} calls per message
        {view.callsMeasured ? "" : " (default)"}
      </p>
      {view.rates !== null && (view.line !== null ? <Why view={view} line={line} /> : <WhyNever view={view} />)}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Why({ view, line }: { view: ThreadView; line: string }) {
  const rates = view.rates!;
  const at = lineWhy(rates, view.callsPerMessage, view.postCompaction, view.line!);
  const perM = (usd: number) => formatUsd(usd * 1_000_000);
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer text-foreground">Why {line}?</summary>
      <div className="mt-2 flex flex-col gap-1">
        <p>
          At {line}, compacting costs about {formatUsd(at.compactUsd)}: one warm read of the context and a 20k summary.
        </p>
        <p>
          Your first message back after the cache goes cold would cost {formatUsd(at.savedUsd)} more without it: rewriting {line} at{" "}
          {perM(rates.w)}/M instead of {formatSize(view.postCompaction)}
          {view.postMeasured ? "" : " (assumed)"}, and {view.callsPerMessage.toFixed(1)} reads at {perM(rates.r)}/M.
        </p>
        <p>{line} is the smallest size at which that saving repays compacting as many times over as the handle asks. A cold rewrite of the whole thread at {line} costs {formatUsd(at.coldRewriteUsd)}.</p>
      </div>
    </details>
  );
}

/** "Why never?": the same figures at the whole window, where even the most compacting can save falls short. */
function WhyNever({ view }: { view: ThreadView }) {
  const window = formatSize(view.window);
  const at = lineWhy(view.rates!, view.callsPerMessage, view.postCompaction, view.window);
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer text-foreground">Why never?</summary>
      <div className="mt-2 flex flex-col gap-1">
        <p>
          Even at {window}, this model's whole context window, compacting would cost about {formatUsd(at.compactUsd)}, and your first
          message back after the cache goes cold would save {formatUsd(at.savedUsd)} by it.
        </p>
        <p>That saving does not repay compacting as many times over as the handle asks, at any size this thread can reach. A lower setting gives a line.</p>
      </div>
    </details>
  );
}
