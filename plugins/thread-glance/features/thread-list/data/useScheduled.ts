// Scheduled sends: one map pushed by the server, no per-row requests.
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type ScheduledSignal } from "@/shared/signals";

const NONE: Readonly<Record<string, number>> = {};

/** threadId → earliest future sendAt; empty until loaded or on error. */
export function useScheduled(): Readonly<Record<string, number>> {
  const rpc = useRpc<RpcContract>();
  const [scheduled, setScheduled] = useState<Readonly<Record<string, number>>>(NONE);
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    rpc.call("listScheduled", null).then(
      (result) => {
        if (!cancelled) setScheduled(result.status === "ready" ? result.scheduled : NONE);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, reload]);

  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) setReload((value) => value + 1);
    wasConnected.current = true;
  }, [connection]);

  useRealtime(CHANNELS.scheduled, (payload) => {
    const signal = payload as ScheduledSignal;
    if (signal === null || typeof signal !== "object") return;
    setScheduled(signal.status === "ready" && signal.scheduled ? signal.scheduled : NONE);
  });

  return scheduled;
}
