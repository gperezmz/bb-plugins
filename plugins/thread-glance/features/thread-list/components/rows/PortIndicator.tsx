// The port indicator: a small plug on a card's third line, and on the folded
// card, while the thread's environment has listening ports. It reads the
// window's one ports snapshot for its environment alone, so a refresh renders
// only the indicators whose environment's listeners changed.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { portIndicatorLabel } from "../../model/ports";
import { usePortListeners } from "../../sync/hooks";

export function PortIndicator({ environmentId }: { environmentId: string | null | undefined }) {
  const count = usePortListeners(environmentId).length;
  if (count === 0) return null;
  return (
    <span data-port-indicator="" role="img" aria-label={portIndicatorLabel(count)} className="flex shrink-0 items-center text-muted-foreground/70">
      <Icon name="thread-glance-ports" aria-hidden className="size-3" />
    </span>
  );
}
