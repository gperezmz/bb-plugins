// Scheduled sends: one map pushed by the server, no per-row requests, fed
// into the list store as threadId → earliest future sendAt.
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type ScheduledSignal } from "@/shared/signals";
import type { ListStore } from "../store/api";

const NONE: Readonly<Record<string, number>> = {};

export function useScheduled(store: ListStore): void {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    rpc.call("listScheduled", null).then(
      (result) => {
        if (!cancelled) store.feed({ scheduled: result.status === "ready" ? result.scheduled : NONE });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, store, reload]);

  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) setReload((value) => value + 1);
    wasConnected.current = true;
  }, [connection]);

  useRealtime(CHANNELS.scheduled, (payload) => {
    const signal = payload as ScheduledSignal;
    if (signal === null || typeof signal !== "object") return;
    const scheduled = signal.status === "ready" && signal.scheduled ? signal.scheduled : NONE;
    store.feedSignal(() => ({ scheduled }));
  });
}
