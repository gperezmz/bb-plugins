// The drop feedback, drawn once over the target row at its model position:
// a ring to nest under it, a red ring where nesting is blocked, a line before
// or after it to reorder pinned threads, and nothing where the drop would
// change nothing. A group or section target highlights its header instead.
import { cn } from "@/lib/utils";
import type { ListItems } from "../../model/layout-items";
import { useDropFeedback } from "../../store/hooks";

export function DropFeedback({ layout }: { layout: ListItems }) {
  const drop = useDropFeedback();
  if (drop === null) return null;
  const index = layout.indicesOf.get(drop.threadId)?.[0];
  if (index === undefined) return null;
  const item = layout.items[index]!;
  const { state } = drop;
  return (
    <div
      aria-hidden
      data-drop-thread-id={drop.threadId}
      data-sidebar-nest-target={state === "valid" || state === "blocked" || state === "unchanged" ? state : undefined}
      data-sidebar-reorder-placement={state === "before" || state === "after" ? state : undefined}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 rounded-md",
        state === "valid" && "ring-1 ring-inset ring-sidebar-ring/80",
        state === "blocked" && "ring-1 ring-inset ring-destructive/60",
        state === "before" && "shadow-[inset_0_2px_0_0_var(--sidebar-ring)]",
        state === "after" && "shadow-[inset_0_-2px_0_0_var(--sidebar-ring)]",
      )}
      style={{ top: item.start, height: item.size }}
    />
  );
}
