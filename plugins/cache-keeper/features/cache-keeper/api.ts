/**
 * The feature's one edge to the server: typed RPC and a loader that refetches
 * on Cache Keeper's change signal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { CHANGED } from "@/src/core/view";
import type { RpcContract } from "@/src/server/rpc";

export const PLUGIN_ID = "cache-keeper";
export const KEEPER_ICON = `${PLUGIN_ID}/cache-keeper`;

export function useKeeperRpc() {
  return useRpc<RpcContract>();
}

/** True when a change signal names one of these threads, or names none. */
export function touches(payload: unknown, threadIds: readonly string[]): boolean {
  const ids = (payload as { threadIds?: unknown } | null)?.threadIds;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.some((id) => threadIds.includes(id as string));
}

/**
 * Loads a value over RPC, refetching on the change signal when `relevant`
 * says it concerns this value, and every `pollMs` so countdowns stay current.
 */
export function useLive<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  relevant: (payload: unknown) => boolean = () => true,
  pollMs = 30_000,
): { data: T | null; error: string | null; reload: () => void; setData: (value: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    load().then(
      (value) => {
        if (mine !== seq.current) return;
        setData(value);
        setError(null);
      },
      (cause: unknown) => {
        if (mine !== seq.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);
  useRealtime(CHANGED, (payload: unknown) => {
    if (relevant(payload)) reload();
  });
  return { data, error, reload, setData };
}

/** The current time, ticking every `ms`, for countdowns. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
