// When each thread last went from busy to idle, as this list saw it: the
// orphaned-failure wait counts from it. Kept in memory, so a reload falls
// back to each thread's last finish.
import { useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { trackIdle, type IdleTracker } from "../model/attention";

const NONE: Readonly<Record<string, number>> = {};

export function useIdleSince(threads: readonly PluginSidebarThread[]): Readonly<Record<string, number>> {
  const [seen, setSeen] = useState<readonly PluginSidebarThread[] | null>(null);
  const [tracker, setTracker] = useState<IdleTracker | null>(null);
  // Adjusted during render, as React adjusts state from a changed input, so
  // the render that sees the change already carries its time.
  if (threads !== seen) {
    const at = Date.now();
    setSeen(threads);
    setTracker((previous) => trackIdle(previous, threads, at));
  }
  return tracker?.idleSince ?? NONE;
}
