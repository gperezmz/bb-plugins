// The Status slot drawn: a status's glyph and label in its colour. Colours are
// bb-theme variables (see theme/theme.css), never `dark:` utilities.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { StatusGlyph, StatusSlot, StatusTone } from "../../model/status-slot";

export const TONE_CLASS: Record<StatusTone, string> = {
  failed: "text-[color:var(--tg-failed)]",
  "needs-you": "text-[color:var(--tg-needs-you)]",
  working: "text-[color:var(--tg-working)]",
  unread: "text-[color:var(--tg-unread)]",
  draft: "text-[color:var(--tg-draft)]",
  muted: "text-muted-foreground",
};

export function GlyphMark({ glyph, className }: { glyph: StatusGlyph; className?: string }) {
  if (glyph.kind === "dot") return <span aria-hidden className={cn("inline-block size-[6px] shrink-0 rounded-full bg-current", className)} />;
  return (
    <Icon
      name={glyph.name}
      aria-hidden
      className={cn("size-3 shrink-0", glyph.spin && "animate-spin", glyph.shine && "animate-shine-icon motion-reduce:animate-none", className)}
    />
  );
}

/** The slot's one thing: the glyph, then the label, truncated to the slot. */
export function StatusView({ status, className }: { status: StatusSlot; className?: string }) {
  return (
    <span
      data-status={status.kind}
      role={status.kind === "plugin" ? "img" : undefined}
      aria-label={status.kind === "plugin" ? `${status.ariaLabel}, ${status.label}` : status.ariaLabel}
      className={cn(
        "flex max-w-full min-w-0 items-center justify-end gap-1 text-[10px] leading-none font-medium",
        TONE_CLASS[status.tone],
        status.timed && "tabular-nums",
        className,
      )}
    >
      {status.glyph === null ? null : <GlyphMark glyph={status.glyph} />}
      <span className="min-w-0 truncate">{status.label}</span>
    </span>
  );
}

/** The folded card's form: the glyph and the time the work has run or the age, the label for assistive technology. */
export function CompactStatusView({ status }: { status: StatusSlot }) {
  const elapsed =
    status.timed && status.label.includes(" · ") ? status.label.split(" · ")[1] : status.kind === "age" || status.kind === "plugin" ? status.label : null;
  return (
    <span data-status={status.kind} className={cn("flex shrink-0 items-center gap-1 text-[10px] leading-none font-medium tabular-nums", TONE_CLASS[status.tone])}>
      {status.glyph === null ? null : <GlyphMark glyph={status.glyph} />}
      {elapsed === null ? null : <span aria-hidden>{elapsed}</span>}
      <span className="sr-only">{status.kind === "plugin" ? `${status.ariaLabel}, ${status.label}` : status.label}</span>
    </span>
  );
}
