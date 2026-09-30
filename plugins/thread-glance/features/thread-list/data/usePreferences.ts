// Server-side preferences: kv via RPC, realtime to every window, a
// localStorage mirror for first paint. They live in the list store, which
// also writes them (debounced) when this window changes one.
import { useCallback, useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type PreferenceSignal } from "@/shared/signals";
import { BB_PREFERENCES_MIRROR_STORAGE_KEY, isPreferenceKey, parsePreference } from "@/shared/preferences";
import type { ListStore } from "../store/api";
import { readJson } from "./storage";

export function usePreferences(store: ListStore): void {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(async () => {
    try {
      const { preferences } = await rpc.call("listPreferences", null);
      store.receivePreferences(preferences);
    } finally {
      // Failed, the mirror stands in.
      store.feed({ hydrated: true });
    }
  }, [rpc, store]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await rpc.call("importPreferences", { bbMirror: readJson(BB_PREFERENCES_MIRROR_STORAGE_KEY) });
      } catch {
        // Import is best effort; the defaults stand.
      }
      if (!cancelled) await load().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc, load]);

  // Realtime signals aren't replayed: re-read after a reconnect.
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) void load().catch(() => undefined);
    wasConnected.current = true;
  }, [connection, load]);

  useRealtime(CHANNELS.preferences, (payload) => {
    const signal = payload as PreferenceSignal;
    if (!isPreferenceKey(signal?.key)) return;
    const parsed = parsePreference(signal.key, signal.value);
    if (parsed.success) store.receivePreference(signal.key, parsed.value);
  });
}
