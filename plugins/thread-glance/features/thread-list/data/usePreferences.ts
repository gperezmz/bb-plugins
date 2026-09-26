// Server-side preferences: kv via RPC, realtime to every window, a
// localStorage mirror for first paint, and debounced writes.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RpcContract } from "@/shared/contract";
import { CHANNELS, type PreferenceSignal } from "@/shared/signals";
import {
  BB_PREFERENCES_MIRROR_STORAGE_KEY,
  coercePreferences,
  isPreferenceKey,
  parsePreference,
  PREFERENCES_MIRROR_STORAGE_KEY,
  type PreferenceKey,
  type Preferences,
} from "@/shared/preferences";
import { sameWindow, useSameWindow } from "./same-window";
import { readJson, writeJson } from "./storage";

const WRITE_DEBOUNCE_MS = 150;

const copies = sameWindow<Partial<Preferences>>();
// Writes not yet sent, whichever copy made them: a reload or an echo in any
// copy must not put back the value one of them replaced.
const pending = new Map<PreferenceKey, unknown>();

export interface PreferencesState {
  prefs: Preferences;
  /** The server's values have arrived (or failed; the mirror stands in). */
  hydrated: boolean;
  update(patch: Partial<Preferences>): void;
}

export function usePreferences(): PreferencesState {
  const rpc = useRpc<RpcContract>();
  const [prefs, setPrefs] = useState<Preferences>(() =>
    coercePreferences(readJson(PREFERENCES_MIRROR_STORAGE_KEY)),
  );
  const [hydrated, setHydrated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(false);

  const load = useCallback(async () => {
    try {
      const { preferences } = await rpc.call("listPreferences", null);
      const next = coercePreferences(preferences);
      // Keys with a write in flight keep the local value.
      for (const [key, value] of pending) (next as Record<string, unknown>)[key] = value;
      setPrefs(next);
      writeJson(PREFERENCES_MIRROR_STORAGE_KEY, next);
    } finally {
      setHydrated(true);
    }
  }, [rpc]);

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
    if (!isPreferenceKey(signal?.key) || pending.has(signal.key)) return;
    const parsed = parsePreference(signal.key, signal.value);
    if (!parsed.success) return;
    setPrefs((current) => {
      const next = { ...current, [signal.key]: parsed.value };
      writeJson(PREFERENCES_MIRROR_STORAGE_KEY, next);
      return next;
    });
  });

  const flush = useCallback(() => {
    const writes = [...pending];
    pending.clear();
    for (const [key, value] of writes) {
      rpc.call("setPreference", { key, value }).catch((error: unknown) => {
        toast.error(`Couldn't save the ${key} setting`, {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }, [rpc]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      flush();
    },
    [flush],
  );

  // Another copy's change arrives already mirrored and on its way to the server.
  const tellOthers = useSameWindow(copies, setPrefs);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((current) => {
        const next = { ...current, ...patch };
        writeJson(PREFERENCES_MIRROR_STORAGE_KEY, next);
        return next;
      });
      tellOthers(patch);
      for (const [key, value] of Object.entries(patch)) {
        if (isPreferenceKey(key)) pending.set(key, value);
      }
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, WRITE_DEBOUNCE_MS);
    },
    [flush, tellOthers],
  );

  return { prefs, hydrated, update };
}
