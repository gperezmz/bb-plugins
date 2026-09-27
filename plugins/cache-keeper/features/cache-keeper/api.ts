/**
 * The feature's one edge to the server: typed RPC and a loader that refetches
 * on Cache Keeper's change signal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { CHANGED, type RowGlyph, type ThreadView } from "@/src/core/view";
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

/** The thread of the composer a surface is mounted in, or null outside a thread. */
export function useComposerThreadId(): string | null {
  const { scope } = useComposer();
  return scope.kind === "thread" ? scope.threadId : null;
}

/** Runs an RPC that answers with the thread's new view, keeping its error to show. */
export function useAction(onDone: (next: ThreadView | null) => void) {
  const [error, setError] = useState<string | null>(null);
  const run = (call: Promise<ThreadView | null>) =>
    call.then(
      (next) => {
        setError(null);
        onDone(next);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  return { run, error };
}

/**
 * The rows that show a Cache Keeper glyph, for the sidebar script, which
 * runs outside React and so cannot use `useRpc`.
 */
export async function fetchRowStatuses(signal: AbortSignal): Promise<RowGlyph[]> {
  const res = await fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/rowStatuses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
    signal,
  });
  if (!res.ok) throw new Error(`rowStatuses: HTTP ${res.status}`);
  const body = (await res.json()) as RowGlyph[] | { result?: RowGlyph[] };
  return Array.isArray(body) ? body : (body.result ?? []);
}
