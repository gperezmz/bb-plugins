import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "./Glyph";
import { TONE_BORDER, TONE_TEXT, type Tone } from "./tones";

/** A small rounded mark beside a name, such as `default` or `can write`, in a tone's text and border, led by `icon` where given. */
export function Pill({ tone = "grey", icon, children, className }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-xs font-normal", TONE_TEXT[tone], TONE_BORDER[tone], className)}>
      {icon !== undefined ? <Glyph name={icon} className="size-3" /> : null}
      {children}
    </span>
  );
}
