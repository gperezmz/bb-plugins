// When each thread last went from busy to idle, as this list saw it: the
// orphaned-failure wait counts from it. The server records the same moment
// as `idleAt` from bb's events, so a reload or another window keeps it; the
// changes bb sends no event for, one window reports.
import { useEffect, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { trackIdle, type IdleTracker } from "../model/attention";
import { useIdleReporter } from "./useIdleReporter";

const NONE: Readonly<Record<string, number>> = {};

export function useIdleSince(
  threads: readonly PluginSidebarThread[],
  reportIdle: (threadIds: string[]) => void,
): Readonly<Record<string, number>> {
  const [seen, setSeen] = useState<readonly PluginSidebarThread[] | null>(null);
  const [tracker, setTracker] = useState<IdleTracker | null>(null);
  // Adjusted during render, as React adjusts state from a changed input, so
  // the render that sees the change already carries its time.
  if (threads !== seen) {
    const at = Date.now();
    setSeen(threads);
    setTracker((previous) => trackIdle(previous, threads, at));
  }
  const isReporter = useIdleReporter();
  useEffect(() => {
    if (tracker !== null && tracker.unannounced.length > 0 && isReporter()) reportIdle([...tracker.unannounced]);
  }, [tracker, reportIdle, isReporter]);
  return tracker?.idleSince ?? NONE;
}
