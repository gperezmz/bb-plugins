// State glyphs, chip glyphs and header counters. They draw what the model
// decided; tone and animation come from host token classes only.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { Counters } from "../model/counters";
import { FLAG_GLYPHS, type ChipTone, type Flag, type Glyph, type Tone } from "../model/state";

export const TONE_CLASS: Record<Tone, string> = {
  attention: "text-attention",
  destructive: "text-destructive",
  // bb's timeline accent: blue, readable on the sidebar in both themes.
  working: "text-[var(--timeline-accent)]",
  background: "text-muted-foreground/50",
  "muted-strong": "text-muted-foreground/75",
  muted: "text-muted-foreground",
  none: "",
};

// The tone colour is one of bb's tokens, mixed toward the foreground for the
// text so it clears 4.5:1 on the sidebar in both themes; the border and fill
// are the same colour, thinned. Written out in full so the class scan sees them.
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  attention:
    "border-[color:color-mix(in_oklch,var(--attention)_45%,transparent)] bg-[color-mix(in_oklch,var(--attention)_10%,transparent)] text-[color:color-mix(in_oklch,var(--attention),var(--foreground)_55%)] hover:bg-[color-mix(in_oklch,var(--attention)_20%,transparent)]",
  destructive:
    "border-[color:color-mix(in_oklch,var(--destructive-text)_45%,transparent)] bg-[color-mix(in_oklch,var(--destructive-text)_10%,transparent)] text-[color:color-mix(in_oklch,var(--destructive-text),var(--foreground)_55%)] hover:bg-[color-mix(in_oklch,var(--destructive-text)_20%,transparent)]",
  working:
    "border-[color:color-mix(in_oklch,var(--timeline-accent)_45%,transparent)] bg-[color-mix(in_oklch,var(--timeline-accent)_10%,transparent)] text-[color:color-mix(in_oklch,var(--timeline-accent),var(--foreground)_55%)] hover:bg-[color-mix(in_oklch,var(--timeline-accent)_20%,transparent)]",
  neutral: "border-border/70 text-muted-foreground hover:bg-state-hover hover:text-foreground",
};

const SHINE = "animate-shine-icon motion-reduce:animate-none";
const SPIN = "animate-spin motion-reduce:animate-none";

// The unread dot takes bb's timeline accent, the one blue bb has, so unread
// reads against the neutral list; bb's own list draws it in the grey primary.
export function UnreadDot({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-[6px] shrink-0 rounded-full bg-[var(--timeline-accent)]", className)}
    />
  );
}

export function GlyphIcon({
  glyph,
  label,
  className,
}: {
  glyph: Glyph;
  label?: string;
  className?: string;
}) {
  if (glyph.icon === null) return null;
  if (glyph.icon === "dot") return <UnreadDot label={label} />;
  return (
    <Icon
      name={glyph.icon}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "size-4 shrink-0",
        TONE_CLASS[glyph.tone],
        glyph.spin && SPIN,
        glyph.shine && SHINE,
        className,
      )}
    />
  );
}

/** A plugin row status in place of the state glyph. */
export function PluginStatusGlyph({ status }: { status: PluginSidebarThreadRowStatus }) {
  const tone =
    status.tone === "error"
      ? "text-destructive"
      : status.tone === "success"
        ? "text-success-foreground"
        : status.tone === "running"
          ? "text-success motion-safe:animate-pulse"
          : "text-muted-foreground";
  return (
    <Icon
      name={status.icon}
      aria-label={status.label}
      className={cn("size-4 shrink-0", tone, status.tone === "running" && SHINE)}
    />
  );
}

export function FlagGlyph({ flag, className }: { flag: Flag; className?: string }) {
  return <GlyphIcon glyph={FLAG_GLYPHS[flag]} className={className} />;
}

const COUNTER_ITEMS: readonly {
  key: keyof Counters;
  flag: Flag;
  label: (count: number) => string;
}[] = [
  { key: "needsYou", flag: "needs-you", label: (n) => `${n} need${n === 1 ? "s" : ""} you` },
  { key: "failed", flag: "unread-failed", label: (n) => `${n} failed` },
  { key: "offline", flag: "offline", label: (n) => `${n} waiting for an offline machine` },
  { key: "working", flag: "working", label: (n) => `${n} working` },
  { key: "unread", flag: "unread", label: (n) => `${n} unread` },
];

/** Header counters: zero counters are not drawn. */
export function CounterStrip({ counters, className }: { counters: Counters; className?: string }) {
  const items = COUNTER_ITEMS.filter((item) => counters[item.key] > 0);
  if (items.length === 0) return null;
  return (
    <span
      role="group"
      aria-label={items.map((item) => item.label(counters[item.key])).join(", ")}
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums", className)}
    >
      {items.map((item) => (
        <span key={item.key} aria-hidden className="inline-flex items-center gap-0.5 text-muted-foreground">
          <FlagGlyph flag={item.flag} className="size-3.5" />
          {counters[item.key]}
        </span>
      ))}
    </span>
  );
}
