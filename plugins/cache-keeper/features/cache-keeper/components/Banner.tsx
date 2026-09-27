/**
 * The banner above the composer: one line saying what Cache Keeper is about
 * to do, with the buttons that change it. Its text comes from `bannerOf`;
 * details are on the Cache Keeper page.
 */
import { bannerOf, type BannerAction } from "@/src/core/view";
import { Button } from "@/components/ui/button";
import { touches, useAction, useComposerThreadId, useKeeperRpc, useLive, useNow } from "../api";

export function Banner() {
  const threadId = useComposerThreadId();
  if (threadId === null) return null;
  return <ThreadBanner threadId={threadId} />;
}

const LABELS: Record<BannerAction, string> = {
  "skip-compaction": "Skip",
  "compact-now": "Compact now",
  "undo-compaction": "Undo",
  "skip-warm": "Skip",
  "undo-warm": "Undo",
};

function ThreadBanner({ threadId }: { threadId: string }) {
  const rpc = useKeeperRpc();
  const now = useNow();
  const live = useLive(() => rpc.call("view", { threadId }), [rpc, threadId], (p) => touches(p, [threadId]));
  const { run: act, error } = useAction((next) => next !== null && live.setData(next));
  const banner = live.data === null ? null : bannerOf(live.data, now);
  if (banner === null) return null;

  const call = (action: BannerAction) => {
    switch (action) {
      case "skip-compaction":
        return rpc.call("skip", { threadId, what: "compaction", undo: false });
      case "undo-compaction":
        return rpc.call("skip", { threadId, what: "compaction", undo: true });
      case "compact-now":
        return rpc.call("compactNow", { threadId });
      case "skip-warm":
        return rpc.call("skip", { threadId, what: "warm", undo: false });
      case "undo-warm":
        return rpc.call("skip", { threadId, what: "warm", undo: true });
    }
  };
  return (
    <div role="status" className="flex flex-col gap-1 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{banner.text}</span>
        {banner.actions.map((action) => (
          <Button key={action} size="sm" variant={action === "compact-now" ? "outline" : "ghost"} onClick={() => void act(call(action))}>
            {LABELS[action]}
          </Button>
        ))}
      </div>
      {error !== null && <p className="text-destructive">{error}</p>}
    </div>
  );
}
