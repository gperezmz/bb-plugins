import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { FLAG_TONES, TONE_FILL, TONE_TEXT } from "@/shared/look/tones";
import { nextEntry, type SwitcherEntry } from "./model";

const FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The fleet's name in the Fleet tab's header as a menu of every fleet the thread holds, each with its waiting count and
 * its dot, the one shown checked. Enter, Space or an arrow opens it on the fleet shown; the arrows, Home and End move,
 * Enter or Space picks, and Escape or Tab closes it. The switcher drawn for the fleet picked takes the focus where
 * `takeFocus` is set, and clears it.
 */
export function Switcher({ entries, shown, takeFocus, onPick }: { entries: readonly SwitcherEntry[]; shown: string; takeFocus: MutableRefObject<boolean>; onPick(repo: string): void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const shownAt = Math.max(0, entries.findIndex((entry) => entry.repo === shown));

  useEffect(() => {
    if (!takeFocus.current) return;
    takeFocus.current = false;
    trigger.current?.focus();
  }, [takeFocus]);

  useEffect(() => {
    if (open) items.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const openAt = (at: number) => {
    setActive(at);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (repo: string) => {
    close(true);
    onPick(repo);
  };
  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(shownAt);
    }
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const next = nextEntry(active, event.key, entries.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Fleet ${shown}, one of ${entries.length}: switch fleet`}
        className={cn(FOCUS, "flex min-w-0 items-center gap-1 font-medium hover:underline")}
        onClick={() => (open ? close(false) : openAt(shownAt))}
        onKeyDown={onTriggerKey}
      >
        <span className="min-w-0 truncate">{shown}</span>
        <Glyph name={ICONS.unfolded} className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div role="menu" aria-label="Fleets of this thread" onKeyDown={onMenuKey} className="absolute left-0 top-full z-20 mt-1 flex min-w-56 max-w-80 flex-col rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {entries.map((entry, at) => (
            <button
              key={entry.repo}
              ref={(element) => {
                items.current[at] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={entry.repo === shown}
              aria-label={entry.label}
              tabIndex={at === active ? 0 : -1}
              className={cn(FOCUS, "flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent", entry.repo === shown && "font-semibold")}
              onClick={() => pick(entry.repo)}
            >
              <span aria-hidden className="w-3 shrink-0 text-muted-foreground">{entry.repo === shown ? "✓" : ""}</span>
              <span className="min-w-0 flex-1 truncate">{entry.repo}</span>
              {entry.count !== null ? <span className={cn("tabular-nums font-semibold", TONE_TEXT.amber)}>{entry.count}</span> : null}
              {entry.dot !== null ? <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_FILL[FLAG_TONES[entry.dot]])} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
