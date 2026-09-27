/**
 * The chip's popover: Keep warm while waiting, set on the thread's tree top;
 * then Compact when idle: its switch, the sentence, the context bar with the
 * line's handle, the status line, what the line rests on, and a folded
 * "Why {line}?" with the dollar figures.
 */
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { formatSize, lineWhy } from "@/src/core/line";
import { noLineReason, popoverSentence, statusText, type ThreadView } from "@/src/core/view";
import { useAction, useKeeperRpc } from "../api";
import { formatUsd } from "../model/bar";
import { ContextBar } from "./ContextBar";

export function CompactPopover({ view, now, onChange }: { view: ThreadView; now: number; onChange: (next: ThreadView | null) => void }) {
  const rpc = useKeeperRpc();
  const { run, error } = useAction(onChange);
  const line = formatSize(view.line);
  const lifetime = view.lifetime === null ? "cache lifetime not read yet" : view.lifetime === "5m" ? "5 min cache" : "1 h cache";

  const navigate = useBbNavigate();
  const below = view.treeTop.threadId !== view.threadId;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 font-medium">
          <span id={`${view.threadId}-warm-label`} className={below || view.warmSetting === "never" ? "text-muted-foreground" : undefined}>
            Keep warm while waiting
          </span>
          <Switch
            checked={view.keptWarm}
            disabled={below || view.warmSetting === "never"}
            labelledBy={`${view.threadId}-warm-label`}
            onClick={() => void run(rpc.call("setKeepWarm", { threadId: view.threadId, on: !view.keptWarm }))}
          />
        </div>
        {below && (
          <p className="text-xs text-muted-foreground">
            Set on{" "}
            <button type="button" className="text-foreground hover:underline" onClick={() => navigate.toThread(view.treeTop.threadId)}>
              {view.treeTop.title}
            </button>
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 font-medium">
        <span id={`${view.threadId}-compact-label`}>Compact when idle</span>
        <Switch
          checked={view.compactOn}
          labelledBy={`${view.threadId}-compact-label`}
          onClick={() => void run(rpc.call("setCompact", { threadId: view.threadId, on: !view.compactOn }))}
        />
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

/** A button rather than a native checkbox: bb's composer reverts a checkbox toggled inside it. */
function Switch({ checked, disabled = false, labelledBy, onClick }: { checked: boolean; disabled?: boolean; labelledBy: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`absolute left-0 top-0.5 size-4 rounded-full bg-background shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
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
        <p>
          {noLineReason(view) === "no-setting"
            ? "That saving is less than compacting costs, so no setting gives this thread a line."
            : "That saving does not repay compacting as many times over as the handle asks, at any size this thread can reach. A lower setting gives a line."}
        </p>
      </div>
    </details>
  );
}
