// A clock that ticks each minute (row ages) and at the next deadline
// (scheduled → queued), so rows change without a request.
import { useEffect, useState } from "react";

export function useNow(nextDeadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (nextDeadline === null) return;
    const wait = nextDeadline - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const timeout = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timeout);
  }, [nextDeadline]);
  return now;
}
