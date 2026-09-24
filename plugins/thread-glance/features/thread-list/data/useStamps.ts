// Thread stamps from the plugin server, kept live over realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type StampSignal, type Stamps } from "@/shared/signals";

const EMPTY: Stamps = { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {} };
const KINDS = new Set(Object.keys(EMPTY));

export interface StampsState {
  stamps: Stamps;
  markSeen(threadIds: string[]): void;
  clearSeen(threadIds: string[]): void;
}

export function useStamps(): StampsState {
  const rpc = useRpc<RpcContract>();
  const [stamps, setStamps] = useState<Stamps>(EMPTY);
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(() => {
    rpc.call("listStamps", null).then(
      (result) => setStamps(result.stamps),
      () => undefined,
    );
  }, [rpc]);

  useEffect(load, [load]);
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) load();
    wasConnected.current = true;
  }, [connection, load]);

  const apply = useCallback((signal: StampSignal) => {
    if (!KINDS.has(signal.kind) || !Array.isArray(signal.threadIds)) return;
    setStamps((current) => {
      const map = { ...current[signal.kind] };
      for (const id of signal.threadIds) {
        if (signal.value === null) delete map[id];
        else map[id] = signal.value;
      }
      return { ...current, [signal.kind]: map };
    });
  }, []);

  useRealtime(CHANNELS.stamps, (payload) => apply(payload as StampSignal));

  const markSeen = useCallback(
    (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      apply({ kind: "seenAt", threadIds, value: Date.now() });
      rpc.call("markSeen", { threadIds }).catch(() => undefined);
    },
    [apply, rpc],
  );
  const clearSeen = useCallback(
    (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      apply({ kind: "seenAt", threadIds, value: null });
      rpc.call("clearSeen", { threadIds }).catch(() => undefined);
    },
    [apply, rpc],
  );

  return { stamps, markSeen, clearSeen };
}
