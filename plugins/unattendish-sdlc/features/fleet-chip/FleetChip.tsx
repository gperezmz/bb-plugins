import { useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ThreadFleetView } from "@/src/fleet/application/views";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { FleetHeader } from "@/shared/fleet-header/FleetHeader";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { FLAG_TONES, TONE_FILL, TONE_TEXT } from "@/shared/look/tones";
import { FLEET_TAB_ACTION_ID } from "@/shared/open-fleet-tab";
import { takeFleetTab } from "@/shared/pending-open";
import { requestReview } from "@/shared/review-request";
import { useLive } from "@/shared/use-live";
import { chipFace } from "./model";

/**
 * The Fleet chip in a manager thread's header: the fleet icon with the rows that wait on the operator and a dot for a
 * problem or a warning, the fleet header on hover, the Fleet tab on a click.
 * It draws nothing for a thread that is no manager, and nothing while loading. A Fleets page link that
 * navigated here leaves a wish for the Fleet tab, which this takes once the thread's view has mounted.
 */
export function FleetChip({ threadId, isCompactViewport }: { threadId: string; projectId: string; isCompactViewport: boolean }) {
  const api = useDashboardApi();
  const navigate = useBbNavigate();
  const { data } = useLive(() => api.threadFleet({ threadId }), [api, threadId]);

  useEffect(() => {
    // On a later task: bb's thread view hides its compact panel drawer in its own mount
    // effect, which runs after this one, so an open made here would be hidden at once.
    const later = setTimeout(() => {
      if (takeFleetTab(threadId)) navigate.openThreadPanel({ actionId: FLEET_TAB_ACTION_ID, params: { threadId } });
    });
    return () => clearTimeout(later);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a wish is taken once per thread the header shows.
  }, [threadId]);

  if (data === null || data.kind !== "manager") return null;
  return <ChipButton threadId={threadId} fleet={data} compact={isCompactViewport} />;
}

function ChipButton({ threadId, fleet, compact }: { threadId: string; fleet: Extract<ThreadFleetView, { kind: "manager" }>; compact: boolean }) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  // After a click the tab is open; keep the card closed until the pointer leaves.
  const suppressed = useRef(false);
  const leftSinceClick = useRef(false);
  const face = chipFace(fleet.card, fleet.generatedAt);
  const openTab = () => {
    suppressed.current = true;
    leftSinceClick.current = false;
    setOpen(false);
    navigate.openThreadPanel({ actionId: FLEET_TAB_ACTION_ID, params: { threadId } });
  };
  const button = (
    <button
      type="button"
      aria-label={face.label}
      onClick={openTab}
      onPointerLeave={() => {
        leftSinceClick.current = true;
      }}
      onPointerEnter={() => {
        if (leftSinceClick.current) suppressed.current = false;
      }}
      className={cn(
        // The header's 28 px box, as bb's own header controls draw it: bordered on desktop, bare on a phone. It holds
        // the icon and at most a count, so it never wraps.
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-transparent px-1.5 shadow-none max-md:pointer-coarse:h-9",
        compact ? "border-0" : "border border-border/70",
        CONTROL_HOVER_TRANSITION,
        "text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <span className="relative inline-flex">
        <Glyph name={ICONS.fleet} className="size-4" />
        {face.dot !== null ? <span aria-hidden className={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background", TONE_FILL[FLAG_TONES[face.dot]])} /> : null}
      </span>
      {face.count !== null ? <span className={cn("text-xs font-semibold tabular-nums", TONE_TEXT.amber)}>{face.count}</span> : null}
    </button>
  );
  if (compact) return button;
  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (!next || !suppressed.current) setOpen(next);
      }}
      openDelay={250}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 p-0">
        <FleetHeader card={fleet.card} lastAction={fleet.lastAction} now={fleet.generatedAt} onReview={() => {
            requestReview(threadId);
            openTab();
          }}
          className="p-3"
        />
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Click the chip to open the Fleet tab</p>
      </HoverCardContent>
    </HoverCard>
  );
}
