// bb's 14×14 split mini-map: outranks the state glyph, as in bb's list.
import { cn } from "@/lib/utils";

export interface MiniMapPane {
  paneId: string;
  rect: { x: number; y: number; width: number; height: number };
  isMe: boolean;
  isFocused: boolean;
}

export function SplitMiniMap({
  panes,
  label,
  working,
}: {
  panes: readonly MiniMapPane[];
  label: string;
  working: boolean;
}) {
  const focused = panes.some((pane) => pane.isMe && pane.isFocused);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 14 14"
      width={14}
      height={14}
      shapeRendering="crispEdges"
      className={cn("pointer-events-none size-3.5 shrink-0", !focused && "opacity-60", working && "animate-shine-icon motion-reduce:animate-none")}
    >
      {panes.map((pane) => {
        // bb's geometry: a 1px inset, 12px of drawable space, and a half-pixel
        // stroke inset for outlined panes.
        const inset = pane.isMe ? 0 : 0.5;
        return (
          <rect
            key={pane.paneId}
            x={1 + pane.rect.x * 12 + inset}
            y={1 + pane.rect.y * 12 + inset}
            width={Math.max(pane.rect.width * 12 - 2 * inset, 0)}
            height={Math.max(pane.rect.height * 12 - 2 * inset, 0)}
            strokeWidth={pane.isMe ? 0 : 1}
            className={
              pane.isMe
                ? pane.isFocused
                  ? "fill-primary/70 stroke-none"
                  : "fill-muted-foreground/45 stroke-none"
                : "fill-none stroke-muted-foreground/30"
            }
          />
        );
      })}
    </svg>
  );
}
