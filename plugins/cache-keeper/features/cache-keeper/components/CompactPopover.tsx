/**
 * The chip's popover: the switch, the sentence, the context bar with the
 * line's handle, the status line, what the line rests on, and a folded
 * "Why {line}?" with the dollar figures.
 */
import { useState } from "react";
import { formatSize, lineWhy } from "@/src/core/line";
import { statusText, type ThreadView } from "@/src/core/view";
import { useKeeperRpc } from "../api";
import { formatUsd } from "../model/bar";
import { ContextBar } from "./ContextBar";

export function CompactPopover({ view, now, onChange }: { view: ThreadView; now: number; onChange: (next: ThreadView | null) => void }) {
  const rpc = useKeeperRpc();
  const [error, setError] = useState<string | null>(null);
  const run = (call: Promise<ThreadView | null>) =>
    call.then(
      (next) => {
        setError(null);
        onChange(next);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  const line = formatSize(view.line);
  const lifetime = view.lifetime === null ? "cache lifetime not read yet" : view.lifetime === "5m" ? "5 min cache" : "1 h cache";

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex items-center justify-between gap-3 font-medium">
        <span>Compact when idle</span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={view.compactOn}
          checked={view.compactOn}
          onChange={(e) => void run(rpc.call("setCompact", { threadId: view.threadId, on: e.target.checked }))}
          className="size-4 accent-[var(--primary)]"
        />
      </label>
      <p className="text-muted-foreground">
        When this thread stops at {line} or more, compact it just before its cache goes cold. Never while it's working.
      </p>
      <ContextBar view={view} onSetting={(setting) => void run(rpc.call("setSetting", { threadId: view.threadId, setting }))} />
      <p className="tabular-nums">
        now {view.context === null ? "unknown" : formatSize(view.context)} · {statusText(view, now)}
      </p>
      <p className="text-xs text-muted-foreground">
        {view.model ?? "Model not read yet"} · {lifetime} · {view.callsPerMessage.toFixed(1)} calls per message
        {view.callsMeasured ? "" : " (default)"}
      </p>
      {view.rates !== null && view.line !== null && <Why view={view} line={line} />}
      {view.rates === null && <p className="text-xs text-muted-foreground">No price for this model yet, so there is no line.</p>}
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
        <p>That repays compacting {view.setting}×, the setting the handle is at. A cold rewrite of the whole context now costs {formatUsd(at.coldRewriteUsd)}.</p>
      </div>
    </details>
  );
}
