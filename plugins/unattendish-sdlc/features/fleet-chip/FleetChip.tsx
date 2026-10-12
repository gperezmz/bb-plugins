import { useEffect, useRef, useState } from "react";
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { FleetCardView } from "@/src/fleet/application/views";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { useDashboardApi } from "@/shared/client";
import { FleetCard } from "@/shared/fleet-card/FleetCard";
import { FLEET_TAB_ACTION_ID } from "@/shared/open-fleet-tab";
import { takeFleetTab } from "@/shared/pending-open";
import { useLive } from "@/shared/use-live";
import { chipFace } from "./model";

/**
 * The Fleet chip in a manager thread's header: the fleet's counts, its card on hover, the Fleet tab on a click.
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
  return <ChipButton threadId={threadId} card={data.card} compact={isCompactViewport} />;
}

function ChipButton({ threadId, card, compact }: { threadId: string; card: FleetCardView; compact: boolean }) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  // After a click the tab is open; keep the card closed until the pointer leaves.
  const suppressed = useRef(false);
  const leftSinceClick = useRef(false);
  const face = chipFace(card, compact);
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
        // The header's 28 px box, as the editor picker beside it draws it.
        "inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-transparent px-1.5 shadow-none max-md:pointer-coarse:h-9",
        CONTROL_HOVER_TRANSITION,
        "text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        card.waiting > 0 && "text-foreground",
      )}
    >
      <Icon name="unattendish-sdlc/fleet" className="size-4" aria-hidden />
      {face.text !== null ? <span className="text-xs font-medium tabular-nums">{face.text}</span> : null}
      {face.dot ? <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" /> : null}
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
        {/* `threadFleet` carries no server clock, so the card's ages run on this window's. */}
        <FleetCard card={card} now={new Date().toISOString()} className="border-0" />
      </HoverCardContent>
    </HoverCard>
  );
}
