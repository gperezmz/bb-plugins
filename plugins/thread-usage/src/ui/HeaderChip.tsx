/**
 * The header chip: an icon-only coin, shown once the family has
 * a turn record. Hover or focus shows the headline, the token bar and the
 * descendant count; clicking opens the Usage tab for this pane's thread.
 */
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ChipView } from "../core/report-types";
import { formatCount, formatTokens, formatUsd } from "../core/format";
import { figureTokenCount } from "../core/figure-math";
import { CoinIcon, TokenBar, touches, useLive, useUsageRpc, USAGE_ACTION_ID } from "./common";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export function HeaderChip({
  threadId,
  isCompactViewport,
}: {
  threadId: string;
  projectId: string;
  isCompactViewport: boolean;
}) {
  const rpc = useUsageRpc();
  const { values } = useSettings();
  const showAmount = values?.showAmount === true && !isCompactViewport;
  // A change names the changed threads and all their ancestors, so a signal
  // that does not name this thread cannot move its family total. Budget
  // crossings and price or settings changes name no thread: every chip refetches.
  const { data } = useLive(() => rpc.call("chip", { threadId }), [rpc, threadId], (payload) => touches(payload, [threadId]));
  useBudgetToast(data, typeof values?.currency === "string" && values.currency !== "" ? values.currency : "$");
  if (data === null || !data.visible) return null;
  return <ChipButton threadId={threadId} chip={data} showAmount={showAmount} />;
}

function useBudgetToast(chip: ChipView | null, currency: string) {
  const rpc = useUsageRpc();
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const t = chip?.toast;
    if (t == null) return;
    const key = `${t.rootThreadId}@${t.amount}`;
    if (shown.current.has(key)) return;
    shown.current.add(key);
    // The server hands the toast to exactly one window.
    void rpc.call("claimToast", { rootThreadId: t.rootThreadId, amount: t.amount }).then(({ claimed }) => {
      if (claimed) toast.warning(`“${t.title}” crossed ${formatUsd(t.amount, currency)}`, {
          description: `Now ${t.total}. Nothing was stopped.`,
        });
    });
  }, [chip, rpc, currency]);
}

export function ChipButton({ threadId, chip, showAmount }: { threadId: string; chip: ChipView; showAmount: boolean }) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  // After a click the tab is open; keep the card closed until the pointer leaves.
  const suppressed = useRef(false);
  const leftSinceClick = useRef(false);
  const label = `Usage: ${chip.headline.primary}${chip.descendants > 0 ? ` with ${formatCount(chip.descendants)} child thread${chip.descendants === 1 ? "" : "s"}` : ""}`;
  const openTab = () => {
    suppressed.current = true;
    leftSinceClick.current = false;
    setOpen(false);
    navigate.openThreadPanel({ actionId: USAGE_ACTION_ID, params: { threadId } });
  };
  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (!next || !suppressed.current) setOpen(next);
      }}
      openDelay={250}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={openTab}
          // Radix's delayed open can fire after the pointer left, so the card
          // stays suppressed until the pointer comes back.
          onPointerLeave={() => {
            leftSinceClick.current = true;
          }}
          onPointerEnter={() => {
            if (leftSinceClick.current) suppressed.current = false;
          }}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            chip.attention && "text-warning hover:text-warning",
          )}
        >
          <CoinIcon className="size-4" />
          {showAmount ? <span className="text-xs font-medium tabular-nums">{chip.chip}</span> : null}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 p-3" onClick={openTab}>
        <ChipSummary chip={chip} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function ChipSummary({ chip }: { chip: ChipView }) {
  const tokens = figureTokenCount({ tokens: chip.tokens, untrackedTokens: chip.untrackedTokens });
  return (
    <div className="cursor-pointer space-y-2">
      <div>
        <div className="text-xl font-semibold tabular-nums text-foreground">{chip.headline.primary}</div>
        <div className="text-xs text-muted-foreground">{chip.headline.detail}</div>
        {chip.headline.secondary !== null ? (
          <div className="text-xs text-muted-foreground">{chip.headline.secondary}</div>
        ) : null}
        {chip.headline.unpricedNote !== null ? (
          <div className="text-xs text-muted-foreground">{chip.headline.unpricedNote}</div>
        ) : null}
      </div>
      <TokenBar tokens={chip.tokens} untracked={chip.untrackedTokens} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {chip.headline.primaryKind === "tokens"
            ? `${chip.turns} turn${chip.turns === 1 ? "" : "s"}`
            : `${formatTokens(tokens)} tokens`}
        </span>
        <span>
          {chip.descendants === 0
            ? "No child threads"
            : `${formatCount(chip.descendants)} child thread${chip.descendants === 1 ? "" : "s"}${chip.hiddenDescendants > 0 ? ` (${formatCount(chip.hiddenDescendants)} hidden)` : ""}`}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground/80">Click for the full breakdown</div>
    </div>
  );
}
