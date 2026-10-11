// The component that keeps the plugin's data current: it follows the plugin
// server's realtime channels and asks `sync` for what it missed, on mount and
// after a reconnect. It draws nothing. Mounted in bb's app overlay slot, it
// outlives the sidebar, so a list mounted again asks for nothing; where bb has
// no such slot, the list mounts it, and a list mounted again asks for what
// changed while it was gone.
import { useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import {
  appearanceSignalSchema,
  CHANNELS,
  orderSignalSchema,
  recordsSignalSchema,
  settingsSignalSchema,
} from "@/shared/signals";
import { portsSignalSchema } from "@/shared/ports";
import { pluginData } from "./plugin-data";
import { documentPage, followPorts } from "./ports-requests";
import { requestSync } from "./requests";

/** How long a keeper waits for realtime to connect before it asks `sync` without it. */
const UNCONNECTED_WAIT_MS = 3_000;

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

  useEffect(() => pluginData.follow(), []);

  // Asks once realtime is up: on mount, and after a reconnect, since
  // realtime signals aren't replayed.
  useEffect(() => {
    const reason = pluginData.connection(connection);
    if (reason !== null) void requestSync(rpc, reason);
  }, [connection, rpc]);

  // A connection that does not come up leaves the list drawn from the
  // answer alone, and asks again once it does.
  useEffect(() => {
    if (connection === "connected") return;
    const timer = setTimeout(() => {
      if (pluginData.get().status === "waiting") void requestSync(rpc, "missed");
    }, UNCONNECTED_WAIT_MS);
    return () => clearTimeout(timer);
  }, [connection, rpc]);

  // The cache is written before the page goes.
  useEffect(() => {
    const onHide = () => pluginData.flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // The workspace ports: read now, 10 s after each read while the page is visible, and when it is shown again.
  useEffect(() => followPorts(rpc, documentPage), [rpc]);

  useRealtime(CHANNELS.records, (payload) => {
    const parsed = recordsSignalSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!pluginData.signal(parsed.data)) void requestSync(rpc, "missed");
  });
  useRealtime(CHANNELS.settings, (payload) => {
    const parsed = settingsSignalSchema.safeParse(payload);
    if (parsed.success) pluginData.settingsSignal(parsed.data);
  });
  useRealtime(CHANNELS.order, (payload) => {
    const parsed = orderSignalSchema.safeParse(payload);
    if (parsed.success) pluginData.orderSignal(parsed.data);
  });
  useRealtime(CHANNELS.appearance, (payload) => {
    const parsed = appearanceSignalSchema.safeParse(payload);
    if (parsed.success) pluginData.appearanceSignal(parsed.data);
  });
  useRealtime(CHANNELS.ports, (payload) => {
    const parsed = portsSignalSchema.safeParse(payload);
    if (parsed.success) pluginData.portsSignal(parsed.data);
  });
  return null;
}
