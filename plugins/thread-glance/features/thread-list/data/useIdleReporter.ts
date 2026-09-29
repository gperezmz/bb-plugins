// Which window reports the changes to idle that bb sends no event for: the
// one list in this browser holding a Web Lock, so a browser with several
// windows open sends each report once. Where the browser has no Web Locks,
// every window reports and the server keeps the later moment.
import { useCallback, useEffect, useRef } from "react";

export const IDLE_REPORTER_LOCK = "bb.thread-glance.idle-reporter";

/** Returns a call that says whether this list is the one that reports. */
export function useIdleReporter(): () => boolean {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  const holding = useRef(locks === undefined);
  useEffect(() => {
    if (locks === undefined) return;
    const waiting = new AbortController();
    let release: () => void = () => undefined;
    locks
      .request(IDLE_REPORTER_LOCK, { signal: waiting.signal }, () => {
        holding.current = true;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => undefined);
    return () => {
      waiting.abort();
      holding.current = false;
      release();
    };
  }, [locks]);
  return useCallback(() => holding.current, []);
}
