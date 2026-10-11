// Jump hints on the rows: while the shortcut modifier is held alone, the
// first nine rows show the key bb jumps to them with, in place of their
// status. The hold's rule is in ../../model/jump-hints; this binds it to the
// window and the rows in document order, which is how bb numbers its jumps.
import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { JUMP_COUNT, jumpLabel, trackHold } from "../../model/jump-hints";

const TARGET_SELECTOR = "[data-sidebar-thread-shortcut-target]";

const NO_HINTS: ReadonlyMap<string, string> = new Map();
let hints = NO_HINTS;
const listeners = new Set<() => void>();

function setHints(next: ReadonlyMap<string, string>): void {
  hints = next;
  for (const listener of [...listeners]) listener();
}

/** The thread's jump hint while the modifier is held, else null; only the nine hinted rows render for it. */
export function useJumpHint(threadId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hints.get(threadId) ?? null,
    () => null,
  );
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Follows the modifier on the window; `rootRef` is the list, whose rows the hints label. */
export function useJumpHints(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const mac = isMac();
    const hold = trackHold({
      mac,
      show() {
        const next = new Map<string, string>();
        const targets = document.querySelectorAll<HTMLElement>(TARGET_SELECTOR);
        let position = 0;
        for (const target of targets) {
          position += 1;
          if (position > JUMP_COUNT) break;
          const threadId = target.dataset.sidebarThreadId;
          if (threadId !== undefined && rootRef.current?.contains(target)) next.set(threadId, jumpLabel(position, mac));
        }
        setHints(next);
      },
      hide: () => setHints(NO_HINTS),
    });
    const onKeyDown = (event: KeyboardEvent) => hold.keyDown(event);
    const onKeyUp = (event: KeyboardEvent) => hold.keyUp(event);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", hold.blur);
    return () => {
      hold.dispose();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", hold.blur);
    };
  }, [rootRef]);
}

export function JumpHint({ label, className }: { label: string; className?: string }) {
  return (
    <kbd
      aria-hidden
      data-jump-hint=""
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center justify-center rounded-sm bg-state-hover px-1.5 py-1 font-sans text-[10px] leading-none font-normal whitespace-nowrap text-subtle-foreground tabular-nums opacity-80",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
