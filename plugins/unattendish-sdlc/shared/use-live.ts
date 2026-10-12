// Server state: one hook that fetches a view and keeps it fresh. A page reads `data`
// and never copies it into state of its own. A view is fetched on mount, when the
// server signals the board changed, when the realtime connection comes back, and every
// minute as a fallback for a signal that never arrived.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { BOARD_CHANGED } from "./client";
import { messageOf } from "./errors";

export const FALLBACK_POLL_MS = 60_000;

export interface Live<T> {
  /** The latest view; null until the first one arrives. */
  readonly data: T | null;
  /** Why the latest fetch failed; `data` keeps the last view that arrived. */
  readonly error: string | null;
  /** Fetches now; settles once the view (or the failure) is held. */
  refetch(): Promise<void>;
}

interface Held<T> {
  readonly data: T | null;
  readonly error: string | null;
}

/** `load` is called again whenever `deps` change; with `enabled` false nothing is fetched. */
export function useLive<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true): Live<T> {
  const [held, setHeld] = useState<Held<T>>({ data: null, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  // A response that arrives after a newer fetch started, or after the page left, is dropped.
  const latest = useRef(0);

  const refetch = useCallback(() => {
    const mine = ++latest.current;
    return loadRef.current().then(
      (data) => {
        if (mine === latest.current) setHeld({ data, error: null });
      },
      (error: unknown) => {
        if (mine === latest.current) setHeld((previous) => ({ data: previous.data, error: messageOf(error) }));
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setHeld({ data: null, error: null });
    void refetch();
    const timer = setInterval(() => void refetch(), FALLBACK_POLL_MS);
    return () => {
      clearInterval(timer);
      latest.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps name what `load` reads.
  }, [enabled, refetch, ...deps]);

  useRealtime(BOARD_CHANGED, () => {
    if (enabled) void refetch();
  });

  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current === "reconnecting" && connection === "connected" && enabled) void refetch();
    previous.current = connection;
  }, [connection, enabled, refetch]);

  return { data: held.data, error: held.error, refetch };
}

/** What a screen shows for a view: waiting for the first one, failed with nothing to show, or ready. */
export function screenState(live: Pick<Live<unknown>, "data" | "error">): "loading" | "failed" | "ready" {
  if (live.data !== null) return "ready";
  return live.error === null ? "loading" : "failed";
}
