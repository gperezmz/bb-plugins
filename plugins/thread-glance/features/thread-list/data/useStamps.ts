// Thread stamps from the plugin server, kept live over realtime and fed
// into the list store.
import { useCallback, useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type StampSignal } from "@/shared/signals";
import type { ListStore } from "../store/api";

export function useStamps(store: ListStore): void {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(() => {
    rpc.call("listStamps", null).then(
      (result) => store.receiveStamps(result.stamps),
      // Until then every map is empty for want of it; a failure says so too.
      () => store.receiveStamps(null),
    );
  }, [rpc, store]);

  useEffect(load, [load]);
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) load();
    wasConnected.current = true;
  }, [connection, load]);

  useRealtime(CHANNELS.stamps, (payload) => store.applyStamp(payload as StampSignal));
}
