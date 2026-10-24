// The glyph of the most urgent state in a set of threads: a failed, needs-you
// or working icon, or a dot for finished work nobody has read. Drawn by the
// Children chip and by a collapsed worktree group's header.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { URGENCY_GLYPHS } from "../../model/children-chip";
import type { Urgency } from "../../model/forest";
import { TONE_CLASS } from "./StatusView";

export function UrgencyGlyph({ urgency }: { urgency: Urgency }) {
  const glyph = URGENCY_GLYPHS[urgency];
  if (glyph.icon === null) {
    return <span aria-hidden data-urgency="done" className={cn("inline-block size-[6px] shrink-0 rounded-full bg-current", TONE_CLASS[glyph.tone])} />;
  }
  return <Icon name={glyph.icon} aria-hidden data-urgency={urgency} className={cn("size-3 shrink-0", TONE_CLASS[glyph.tone], glyph.tone === "working" && "animate-spin")} />;
}
