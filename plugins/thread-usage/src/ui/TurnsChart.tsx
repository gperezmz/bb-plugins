/**
 * Cost per turn as a hand-drawn SVG bar chart, plus the Outside turns bar.
 * Bars are coloured by cost source with host tokens.
 */
import { useMemo, useRef, useState } from "react";
import { costTotal } from "../core/figure-math";
import { formatTokens, formatUsd } from "../core/format";
import type { CostSource, TurnView } from "../core/summary";
import { totalTokens } from "../core/tokens";
import { cn } from "@/lib/utils";

export const SOURCE_STYLE: Record<CostSource, { fill: string; swatch: string; label: string }> = {
  gateway: { fill: "fill-primary", swatch: "bg-primary", label: "Gateway" },
  harness: { fill: "fill-success", swatch: "bg-success", label: "Harness" },
  estimate: { fill: "fill-primary/45", swatch: "bg-primary/45", label: "Estimate" },
  unpriced: { fill: "fill-muted-foreground/35", swatch: "bg-muted-foreground/35", label: "Unpriced" },
};

const HEIGHT = 96;
const GAP = 2;

export function TurnsChart({
  turns,
  measure,
  currency,
  selected,
  onSelect,
}: {
  turns: readonly TurnView[];
  /** Dollars, or tokens for subscription threads. */
  measure: "usd" | "tokens";
  currency: string;
  selected: string | null;
  onSelect: (turnId: string | null) => void;
}) {
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const bars = useMemo(
    () =>
      turns.map((t) => ({
        turn: t,
        value: measure === "usd" ? costTotal(t.cost) : totalTokens(t.tokens),
        tokens: totalTokens(t.tokens),
      })),
    [turns, measure],
  );
  // Scale by real turns so one large history bar does not flatten them;
  // taller synthetic bars are clipped and drawn faded.
  const scaled = bars.filter((b) => b.turn.kind === "turn" || b.turn.kind === "outside");
  const max = Math.max(...(scaled.length > 0 ? scaled : bars).map((b) => b.value), measure === "usd" ? 0.0001 : 1);
  const n = bars.length;
  if (n === 0) return null;
  // Width in viewBox units; bars stretch to the container.
  const slot = 12;
  // At least 40 slots, so a few turns draw as narrow bars from the left
  // instead of stretching across the panel.
  const width = Math.max(n, 40) * slot;
  const sources = [...new Set(bars.map((b) => b.turn.source))];
  const hovered = hover === null ? null : bars[hover.index];
  const label = (v: number) => (measure === "usd" ? formatUsd(v, currency) : `${formatTokens(v)} tokens`);

  return (
    <div className="relative" ref={box}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-24 w-full"
        role="img"
        aria-label={`Cost per turn for ${n} turns`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={width} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {bars.map((b, i) => {
          const clipped = b.value > max;
          const h = b.value <= 0 ? (b.tokens > 0 ? 2 : 0.5) : Math.max(2, (Math.min(b.value, max) / max) * (HEIGHT - 4));
          const x = i * slot + GAP / 2;
          const w = slot - GAP;
          const isOutside = b.turn.kind === "outside";
          const isSelected = selected === b.turn.turnId;
          return (
            <g key={b.turn.turnId}>
              <rect
                x={x}
                y={HEIGHT - h}
                width={w}
                height={h}
                rx={1.5}
                className={cn(
                  SOURCE_STYLE[b.turn.source].fill,
                  isOutside && "opacity-60",
                  selected !== null && !isSelected && "opacity-40",
                  b.turn.partial && "opacity-70",
                  clipped && "opacity-50",
                )}
              />
              {/* A full-height hit area keeps small bars easy to point at. */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={HEIGHT}
                className="cursor-pointer fill-transparent outline-none focus-visible:fill-primary/10"
                tabIndex={0}
                role="button"
                aria-label={`${turnLabel(b.turn, turnNumbers(turns).get(b.turn.turnId) ?? 0)}: ${label(b.value)}`}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(isSelected ? null : b.turn.turnId);
                  }
                }}
                onFocus={() => setHover({ index: i, x: ((i + 0.5) / Math.max(n, 40)) * (box.current?.clientWidth ?? 0) })}
                onBlur={() => setHover(null)}
                onMouseEnter={(e) => {
                  const rect = box.current?.getBoundingClientRect();
                  setHover({ index: i, x: rect ? e.clientX - rect.left : 0 });
                }}
                onClick={() => onSelect(isSelected ? null : b.turn.turnId)}
              />
            </g>
          );
        })}
      </svg>
      {hovered !== null && hover !== null ? (
        <div
          className="pointer-events-none absolute -top-2 z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.min(Math.max(hover.x, 130), Math.max(130, (box.current?.clientWidth ?? 260) - 130)) }}
        >
          <div className="font-medium">{turnLabel(hovered.turn, turnNumbers(turns).get(hovered.turn.turnId) ?? 0)}</div>
          <div className="tabular-nums text-muted-foreground">
            {measure === "usd" ? `${label(hovered.value)} · ${formatTokens(hovered.tokens)} tokens` : label(hovered.value)}
            {hovered.turn.model !== null ? ` · ${hovered.turn.model.replace(/\[[^\]]*\]$/, "")}` : ""}
          </div>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {sources.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-sm", SOURCE_STYLE[s].swatch)} aria-hidden />
            {SOURCE_STYLE[s].label}
          </span>
        ))}
        {bars.some((b) => b.turn.kind === "outside") ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-primary opacity-40" aria-hidden />
            Last bar: outside turns
          </span>
        ) : null}
        <span className="ml-auto">Click a bar for details</span>
      </div>
    </div>
  );
}

/** 1-based numbers for real turns; synthetic rows get none. */
export function turnNumbers(turns: readonly TurnView[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const t of turns) {
    if (t.kind === "turn" && t.turnId !== "retained") out.set(t.turnId, ++n);
  }
  return out;
}

export function turnLabel(t: TurnView, number: number): string {
  if (t.kind === "outside") return "Outside turns";
  if (t.kind === "opening") return "Before first seen";
  if (t.kind === "history") return "History from harness logs";
  if (t.turnId === "retained") return "Older than a year";
  return `Turn ${number}`;
}
