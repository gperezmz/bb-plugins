// Keeps the window's copy of the tweaks current. The content script cannot
// use hooks, so this renders nothing and does the listening for it.
import { useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { TWEAKS_CHANNEL, parseTweaks } from "@/shared/tweaks";
import { useTweaksRpc } from "../api";
import { tweakState } from "../state";

export function TweaksSync() {
  const rpc = useTweaksRpc();
  const connection = useRealtimeConnectionState();
  // Counts signals, so a read that answers after one does not undo it.
  const signals = useRef(0);

  // Read on mount and on every reconnection: a signal sent while
  // disconnected is not replayed.
  useEffect(() => {
    if (connection === "reconnecting") return;
    const seen = signals.current;
    rpc.call("getTweaks", null).then(
      (tweaks) => {
        if (signals.current === seen) tweakState.set(tweaks);
      },
      () => {},
    );
  }, [rpc, connection]);

  useRealtime(TWEAKS_CHANNEL, (payload) => {
    const tweaks = parseTweaks(payload);
    if (!tweaks) return;
    signals.current += 1;
    tweakState.set(tweaks);
  });

  return null;
}
