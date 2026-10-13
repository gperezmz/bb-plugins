import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import type { Tone } from "@/shared/look/tones";

/** A folding section of the Work tab: a heading with its icon, its name and its count, which folds or unfolds it. */
export function Fold({ id, icon, tone, title, count, open, onToggle, children }: { id: string; icon: string; tone: Tone; title: string; count: number; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="text-sm font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-sm py-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Glyph name={open ? ICONS.unfolded : ICONS.folded} className="size-3 text-muted-foreground" />
          <Glyph name={icon} tone={tone} />
          {title}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
        </button>
      </h3>
      {open ? (
        <div id={`${id}-body`} className="pb-2 pl-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** What a section, a tab or a block says when it has nothing to list. */
export function Empty({ children, className }: { children: string; className?: string }) {
  return <p className={cn("py-1 text-sm text-muted-foreground", className)}>{children}</p>;
}
