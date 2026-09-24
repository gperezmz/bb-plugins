// Inline rename: Enter or blur saves, Escape cancels, IME-safe.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SETTLE_MS = 600;

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "INPUT";
}

export function RenameEditor({
  initial,
  label,
  onSave,
  onDone,
  className,
}: {
  initial: string;
  label: string;
  onSave(value: string): Promise<void>;
  onDone(): void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const settled = useRef(false);
  const userPressedElsewhere = useRef(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== input.current) userPressedElsewhere.current = true;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    // Opening a thread moves focus to its composer just after the click
    // that started the rename; blurs before this settle aren't the user's.
    const timer = setTimeout(() => {
      settled.current = true;
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  const finish = async (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = value.trim();
    if (!save || next === "" || next === initial) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } catch (error) {
      toast.error("Couldn't rename", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onDone();
    }
  };

  return (
    <>
      <input
        ref={input}
        aria-label={label}
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            void finish(false);
          }
        }}
        onBlur={(event) => {
          // Only the thread opening can take focus back: bb moves it into
          // the composer (an editable element) just after the click that
          // started the rename. Any other blur is the user leaving.
          if (!settled.current && !userPressedElsewhere.current && isEditable(event.relatedTarget)) {
            setTimeout(() => {
              input.current?.focus();
              input.current?.select();
            }, 0);
            return;
          }
          void finish(true);
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          "pointer-events-auto relative z-10 h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
      {saving ? (
        <span role="status" className="sr-only">
          Saving name
        </span>
      ) : null}
    </>
  );
}
