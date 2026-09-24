// Thread notes from the plugin server, kept live over realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, threadNotesSchema, type NotesSignal, type ThreadNotes } from "@/shared/signals";

export function useNotes(): Readonly<Record<string, ThreadNotes>> {
  const rpc = useRpc<RpcContract>();
  const [notes, setNotes] = useState<Readonly<Record<string, ThreadNotes>>>({});
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(() => {
    rpc.call("listNotes", null).then(
      (result) => setNotes(result.notes),
      () => undefined,
    );
  }, [rpc]);

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
    setNotes((current) => {
      const next = { ...current };
      if (parsed === null) delete next[signal.threadId];
      else next[signal.threadId] = parsed.data;
      return next;
    });
  });

  return notes;
}
