// The list's one hover card, anchored to the row it shows. When it opens
// and closes is the row card controller's (row-card.ts).
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useOpenCard, useRowAt, useThreadInfo } from "../../store/hooks";
import { ThreadDetails } from "../ThreadDetails";
import { Anchor } from "./Anchor";
import { useOverlays } from "./overlays";

export function CardHost() {
  const card = useOpenCard();
  const overlays = useOverlays();
  const info = useThreadInfo(card?.threadId ?? "");
  const row = useRowAt(card?.groupId ?? "", card?.rowKey ?? "");
  const shown = card !== null && info !== undefined;
  return (
    <HoverCard open={shown} onOpenChange={(open) => !open && overlays.card.close()} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Anchor element={card?.anchor ?? null} />
      </HoverCardTrigger>
      {shown ? (
        <HoverCardContent
          side="right"
          align="start"
          collisionPadding={8}
          className="z-[100] w-72 p-3"
          onPointerEnter={overlays.card.holdOpen}
        >
          <ThreadDetails info={info} showPullRequest={row?.type === "thread" && row.pullRequest !== null} />
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}
