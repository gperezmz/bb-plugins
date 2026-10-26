// A tooltip on bb's theme: Radix's, portaled with the plugin's scope so it
// paints above the sidebar. Not shown on touch, where there is no hover.
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";

export function Tip({
  label,
  children,
  side = "top",
  className,
  open,
}: {
  /** The tooltip's content; null draws no tooltip. */
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Holds the tooltip open or closed itself, for a trigger that never takes the pointer; unset, hovering the trigger decides. */
  open?: boolean;
}) {
  const scope = usePortalScopeProps();
  if (label === null) return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={150}>
      <TooltipPrimitive.Root open={open}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            {...scope}
            side={side}
            sideOffset={4}
            className={cn(
              "z-50 max-w-64 rounded-md border bg-popover px-2 py-1 text-xs whitespace-pre-line text-popover-foreground shadow-md [@media(hover:none)]:hidden",
              className,
            )}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
