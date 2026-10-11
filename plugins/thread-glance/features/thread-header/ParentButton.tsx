// The thread header's way back out of a child thread: "Back to parent: <title>"
// with the parent's mark. The title is dropped on a compact viewport.
import { experimental_Icon as Icon, experimental_useSidebarThreads as useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { useServerSettings } from "../thread-list";
import { ChildMark, Tip } from "../thread-list";
import { backToParentLabel, parentOf } from "./model";

export function ParentButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { threads } = useSidebarThreads();
  const navigate = useBbNavigate();
  const { childIcon } = useServerSettings();
  const parent = parentOf(threads, threadId);
  if (parent === null) return null;
  const label = backToParentLabel(parent);
  return (
    <Tip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={() => navigate.toThread(parent.id)}
        className={cn(
          "flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          isCompactViewport ? "px-1.5" : "px-2",
        )}
      >
        <Icon name="ChevronLeft" aria-hidden className="size-3 shrink-0" />
        <ChildMark threadId={parent.id} providerId={parent.providerId} style={childIcon} />
        {isCompactViewport ? null : <span className="truncate">{parent.displayTitle}</span>}
      </button>
    </Tip>
  );
}
