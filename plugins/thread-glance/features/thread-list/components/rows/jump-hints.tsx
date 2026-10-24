// Jump hints on the rows: while bb's jump modifier is held, each row bb gave a
// jump key shows that key in place of its status. bb decides which rows get
// keys and when the hints show, numbering the row links the list has mounted
// in DOM order, and labels each from its keybindings, so a hint names the
// chord that opens its row.
import { useSidebarThreadShortcut } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

/** The jump key bb shows for the thread while its modifier is held, else null. */
export function useJumpHint(threadId: string): string | null {
  return useSidebarThreadShortcut(threadId)?.label ?? null;
}

export function JumpHint({ label, className }: { label: string; className?: string }) {
  return (
    <kbd
      aria-hidden
      data-jump-hint=""
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center justify-center rounded-sm bg-state-hover px-1.5 py-1 font-sans text-[10px] leading-none font-normal whitespace-nowrap text-subtle-foreground tabular-nums opacity-80",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
