/**
 * The banner above the composer, drawn as bb draws its own status banners:
 * shown only while a compaction is due or after one was skipped, with the
 * buttons that change it. Its text comes from `bannerOf`; keep-warms are on
 * the composer chip.
 */
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { bannerOf, type BannerAction } from "@/src/core/view";
import { TIMER_ICON, touches, useAction, useComposerThreadId, useKeeperRpc, useLive, useNow } from "../api";
import { BannerButton } from "./BannerButton";

export function Banner() {
  const threadId = useComposerThreadId();
  if (threadId === null) return null;
  return <ThreadBanner threadId={threadId} />;
}

const LABELS: Record<BannerAction, string> = {
  "skip-compaction": "Skip",
  "compact-now": "Compact now",
  "undo-compaction": "Undo",
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
    }
  };
  // The error line takes the row's bottom padding and gives it back below
  // itself, so the banner grows by that line alone; its left inset is the
  // icon and the gap, lining it up with the text.
  return (
    <div role="status" className="px-3 text-xs text-muted-foreground">
      <div className="flex min-h-8 items-center gap-1.5 py-1">
        <Icon name={TIMER_ICON} fallback="Archive" className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{banner.text}</span>
        {banner.actions.map((action) => (
          <BannerButton key={action} strong={action === "compact-now"} onClick={() => void act(call(action))}>
            {LABELS[action]}
          </BannerButton>
        ))}
      </div>
      {error !== null && <p className="-mt-1 pb-1 pl-5 text-destructive">{error}</p>}
    </div>
  );
}
