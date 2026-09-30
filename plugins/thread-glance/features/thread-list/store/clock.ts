// The list's clock: it ticks every minute (row times) and at the next
// deadline (a scheduled send, a failure about to become an Orphaned
// failure), so rows change without a request. It stops while the window is
// hidden, and ticks once when it is shown again.

export interface Clock {
  /** Reads the next deadline again, after it changed. */
  reschedule(): void;
  stop(): void;
}

const MINUTE = 60_000;
/** Past the deadline, so the tick sees it passed. */
const DEADLINE_SLACK_MS = 50;
const LONGEST_TIMEOUT = 2 ** 31 - 1;

function hidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function startClock({ tick, nextDeadline }: { tick(): void; nextDeadline(): number | null }): Clock {
  let minute: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  // A tick the timers owe while the window is hidden is dropped here too.
  const guarded = () => {
    if (!hidden()) tick();
  };
  const clear = () => {
    if (minute !== null) clearInterval(minute);
    if (deadline !== null) clearTimeout(deadline);
    minute = null;
    deadline = null;
  };
  const reschedule = () => {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    const at = nextDeadline();
    if (at === null || hidden()) return;
    const wait = at - Date.now();
    if (wait > LONGEST_TIMEOUT) return;
    deadline = setTimeout(() => {
      deadline = null;
      guarded();
    }, Math.max(wait, 0) + DEADLINE_SLACK_MS);
  };
  const start = () => {
    minute = setInterval(guarded, MINUTE);
    reschedule();
  };
  const onVisibility = () => {
    clear();
    if (hidden()) return;
    tick();
    start();
  };
  if (!hidden()) start();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  return {
    reschedule,
    stop() {
      clear();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
