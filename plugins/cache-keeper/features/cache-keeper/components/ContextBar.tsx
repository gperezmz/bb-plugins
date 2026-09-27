/**
 * A bar from 0 to the context window, filled to the current context, with a
 * handle at the line. Dragging moves the handle between the ten settings;
 * clicking the size on the handle lets you type one, which snaps.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatSize } from "@/src/core/line";
import type { ThreadView } from "@/src/core/view";
import { fractionOf, settingAt, settingForText, stepSetting } from "../model/bar";

export function ContextBar({ view, onSetting }: { view: ThreadView; onSetting: (setting: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const setting = dragging ?? view.setting;
  const line = view.lines[setting - 1] ?? null;
  const fill = view.context === null ? 0 : fractionOf(view.context, view.window);
  const at = line === null ? 1 : fractionOf(line, view.window);

  const fromPointer = (e: PointerEvent) => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return setting;
    return settingAt((e.clientX - box.left) / box.width, view.lines, view.window);
  };
  const commit = (next: number) => {
    setDragging(null);
    if (next !== view.setting) onSetting(next);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    commit(stepSetting(view.setting, step, view.lines));
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={track}
        className="relative mt-6 h-2 w-full touch-none rounded-full bg-muted"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDragging(fromPointer(e));
        }}
        onPointerMove={(e) => dragging !== null && setDragging(fromPointer(e))}
        onPointerUp={(e) => dragging !== null && commit(fromPointer(e))}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40" style={{ width: `${fill * 100}%` }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Compaction line"
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={setting}
          aria-valuetext={formatSize(line)}
          onKeyDown={onKey}
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm bg-primary"
          style={{ left: `${at * 100}%` }}
        >
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
            {typing ? (
              <input
                autoFocus
                aria-label="Compaction line size"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setTyping(false);
                  if (e.key !== "Enter") return;
                  const next = settingForText(text, view.lines);
                  setTyping(false);
                  if (next !== null) commit(next);
                }}
                onBlur={() => setTyping(false)}
                className="w-16 rounded border bg-background px-1 text-center text-xs"
              />
            ) : (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setText(formatSize(line));
                  setTyping(true);
                }}
                className="rounded bg-primary px-1 text-xs tabular-nums text-primary-foreground"
              >
                {formatSize(line)}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>0</span>
        <span>{formatSize(view.window)}</span>
      </div>
    </div>
  );
}
