// The component that keeps the plugin's data current: it follows the plugin
// server's realtime channels and asks `sync` for what it missed, on mount and
// after a reconnect. It draws nothing. Mounted in bb's app overlay slot, it
// outlives the sidebar, so a list mounted again asks for nothing; where bb has
// no such slot, the list mounts it, and a list mounted again asks for what
// changed while it was gone.
import { useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, recordsSignalSchema, type PreferenceSignal, type ScheduledSignal } from "@/shared/signals";
import { isPreferenceKey, parsePreference } from "@/shared/preferences";
import { pluginData } from "./plugin-data";
import { requestSync } from "./requests";

const NONE: Readonly<Record<string, number>> = {};

/** The keeper for bb's app overlay slot. */
export function OverlaySyncKeeper() {
  useEffect(() => {
    pluginData.setOverlayMounted(true);
    return () => pluginData.setOverlayMounted(false);
  }, []);
  return <Following />;
}

/** The keeper inside the list, which follows only while no overlay keeper does. */
export function ListSyncKeeper() {
  const overlay = useSyncExternalStore(pluginData.subscribeOverlay, pluginData.isOverlayMounted);
  return overlay ? null : <Following />;
}

function Following() {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();

  useEffect(() => {
    const stop = pluginData.follow();
    if (pluginData.get().status !== "current") void requestSync(rpc);
    return stop;
  }, [rpc]);

  // Realtime signals aren't replayed: ask for what changed after a reconnect.
  useEffect(() => {
    if (pluginData.connection(connection)) void requestSync(rpc);
  }, [connection, rpc]);

  useRealtime(CHANNELS.records, (payload) => {
    const parsed = recordsSignalSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!pluginData.signal(parsed.data)) void requestSync(rpc);
  });
  useRealtime(CHANNELS.preferences, (payload) => {
    const signal = payload as PreferenceSignal;
    if (!isPreferenceKey(signal?.key)) return;
    const parsed = parsePreference(signal.key, signal.value);
    if (parsed.success) pluginData.preferenceSignal(signal.key, parsed.value);
  });
  useRealtime(CHANNELS.scheduled, (payload) => {
    const signal = payload as ScheduledSignal;
    if (signal === null || typeof signal !== "object") return;
    pluginData.scheduledSignal(signal.status === "ready" && signal.scheduled ? signal.scheduled : NONE);
  });
  return null;
}
