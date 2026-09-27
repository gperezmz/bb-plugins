/**
 * The banner above the composer. While a compaction is due: the countdown
 * with Skip and Compact now, then "Skipped until this thread's next idle."
 * with Undo. While a keep-warm or check-in is due: how many things of each
 * kind the thread waits on and the time to the next, with Skip. It never
 * shows command text or descriptions.
 */
import { formatSize } from "@/src/core/line";
import { countsText, minutesTo } from "@/src/core/view";
import { Button } from "@/components/ui/button";
import { touches, useAction, useComposerThreadId, useKeeperRpc, useLive, useNow } from "../api";

export function Banner() {
  const threadId = useComposerThreadId();
  if (threadId === null) return null;
  return <ThreadBanner threadId={threadId} />;
}

function ThreadBanner({ threadId }: { threadId: string }) {
  const rpc = useKeeperRpc();
  const now = useNow();
  const live = useLive(() => rpc.call("view", { threadId }), [rpc, threadId], (p) => touches(p, [threadId]));
  const { run: act, error } = useAction((next) => next !== null && live.setData(next));
  const view = live.data;
  if (view === null || !view.eligible || view.status !== "idle" || view.hasPendingInteraction) return null;

  let body: React.ReactNode = null;
  if (view.compactionDue && view.deadline !== null) {
    body = (
      <>
        <span className="flex-1">
          {view.context === null ? "" : formatSize(view.context)} idle · compacting in {minutesTo(view.deadline, now)}m before the cache goes cold
        </span>
        <Button size="sm" variant="ghost" onClick={() => void act(rpc.call("skip", { threadId, what: "compaction", undo: false }))}>
          Skip
        </Button>
        <Button size="sm" variant="outline" onClick={() => void act(rpc.call("compactNow", { threadId }))}>
          Compact now
        </Button>
      </>
    );
  } else if (view.compactOn && view.compactSkipped && view.compactedAt === null && !view.waiting) {
    body = (
      <>
        <span className="flex-1">Skipped until this thread's next idle.</span>
        <Button size="sm" variant="ghost" onClick={() => void act(rpc.call("skip", { threadId, what: "compaction", undo: true }))}>
          Undo
        </Button>
      </>
    );
  } else if (view.warmDue) {
    const next = view.nextWarmAt === null ? "" : ` · next check-in or keep-warm in ${minutesTo(view.nextWarmAt, now)}m`;
    body = (
      <>
        <span className="flex-1">
          Waiting on {countsText(view.counts)}
          {next}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void act(rpc.call("skip", { threadId, what: "warm", undo: false }))}>
          Skip
        </Button>
      </>
    );
  }
  if (body === null) return null;
  return (
    <div role="status" className="flex flex-col gap-1 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">{body}</div>
      {error !== null && <p className="text-destructive">{error}</p>}
    </div>
  );
}
