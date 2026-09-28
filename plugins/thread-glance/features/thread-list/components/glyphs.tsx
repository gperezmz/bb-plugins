// State glyphs, the children chip's state glyph and header counters. They draw what the model
// decided; tone and animation come from host token classes only.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { Counters } from "../model/counters";
import type { RowNote } from "../model/notes";
import { chipTone, FLAG_GLYPHS, type ChipTone, type Flag, type Glyph, type Tone } from "../model/state";

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

// The Idle state's ring: uncoloured, smaller than the column and thinned, so
// it reads as status yet stays fainter than the unread dot and the draft
// pencil. Screen readers skip it, so an Idle row announces what it did before.
export function IdleRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full border-[1.5px] border-current opacity-50", className)}
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
  if (glyph.icon === "ring") return <IdleRing className={TONE_CLASS[glyph.tone]} />;
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

/** A note's prefix takes the tone of the row's glyph for the same reason. */
const NOTE_TONE_CLASS: Record<RowNote["tone"], string> = {
  attention: "text-attention",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

/** "Failed: timeout", its prefix in the note's tone, or the prefix alone when there is no text. */
export function NoteLine({ note }: { note: RowNote }) {
  return (
    <>
      <span className={NOTE_TONE_CLASS[note.tone]}>{note.text === "" ? note.prefix : `${note.prefix}:`}</span>
      {note.text === "" ? null : ` ${note.text}`}
    </>
  );
}

export function FlagGlyph({ flag, className }: { flag: Flag; className?: string }) {
  return <GlyphIcon glyph={FLAG_GLYPHS[flag]} className={className} />;
}

/** The colour of a children chip's count and chevron while it shows a state: the state glyph's own. */
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  attention: "text-attention",
  destructive: "text-destructive",
  working: "text-[var(--timeline-accent)]",
  unread: "text-[var(--timeline-accent)]",
};

export function chipToneClass(flag: Flag): string {
  return CHIP_TONE_CLASS[chipTone(flag)];
}

/** The state glyph that leads a children chip, smaller than the Status column's; the chip's label names it. */
export function ChipStateGlyph({ flag }: { flag: Flag }) {
  if (FLAG_GLYPHS[flag].icon === "dot") return <UnreadDot className="size-[5px]" />;
  return <FlagGlyph flag={flag} className="size-3" />;
}

const COUNTER_ITEMS: readonly {
  key: keyof Counters;
  flag: Flag;
  label: (count: number) => string;
}[] = [
  { key: "waitsOnYou", flag: "waits-on-you", label: (n) => `${n} waiting on you` },
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
