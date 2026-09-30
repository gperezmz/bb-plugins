// Thread notes from the plugin server, kept live over realtime and fed into
// the list store.
import { useCallback, useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, threadNotesSchema, type NotesSignal } from "@/shared/signals";
import type { ListStore } from "../store/api";

export function useNotes(store: ListStore): void {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(() => {
    rpc.call("listNotes", null).then(
      (result) => store.feed({ notes: result.notes }),
      () => undefined,
    );
  }, [rpc, store]);

  useEffect(load, [load]);
  useEffect(() => {
    if (connection !== "connected") return;
    if (wasConnected.current) load();
    wasConnected.current = true;
  }, [connection, load]);

  useRealtime(CHANNELS.notes, (payload) => {
    const signal = payload as NotesSignal;
    if (signal === null || typeof signal !== "object" || typeof signal.threadId !== "string") return;
    const parsed = signal.notes === null ? null : threadNotesSchema.safeParse(signal.notes);
    if (parsed !== null && !parsed.success) return;
    store.feed(({ notes: current }) => {
      const notes = { ...current };
      if (parsed === null) delete notes[signal.threadId];
      else notes[signal.threadId] = parsed.data;
      return { notes };
    });
  });
}
