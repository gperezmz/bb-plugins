// A row of segments, one chosen, drawn with the classes of bb's own segmented
// control (the Reasoning picker in the model menu).
import { useRef, type KeyboardEvent } from "react";
import { steppedSegment } from "../model/segments";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  label: string;
  segments: readonly Segment<T>[];
  /** The chosen segment, or null while the saved choice is loading. */
  value: T | null;
  onChange(value: T): void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = segments.findIndex((segment) => segment.value === value);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = steppedSegment(event.key, chosen, segments.length);
    if (next === null) return;
    event.preventDefault();
    onChange(segments[next]!.value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex gap-1 rounded-md border border-border/60 bg-card p-0.5"
    >
      {segments.map((segment, index) => {
        const checked = index === chosen;
        return (
          <button
            key={segment.value}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (chosen === -1 && index === 0) ? 0 : -1}
            disabled={value === null}
            onClick={() => onChange(segment.value)}
            className={`h-6 min-w-0 shrink-0 whitespace-nowrap rounded-sm px-2 text-xs font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${
              checked
                ? "bg-state-active text-foreground hover:bg-state-active"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground"
            }`}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
