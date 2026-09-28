/**
 * A text button drawn as bb draws its own status banners' buttons: 22 px
 * tall, 4 px radius, a 1 px border, text-sized. The banner and the popover's
 * keep-warm line both use it, so the two match.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BannerButton({ strong = false, onClick, children }: { strong?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs shadow-xs hover:bg-state-hover hover:text-foreground",
        strong ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
