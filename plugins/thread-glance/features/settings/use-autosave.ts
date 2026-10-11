// The settings page's saving, bound to bb: the controller (model/autosave.ts)
// writes through the plugin server and shows its answer at once, and what is
// pending goes when the page is left.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { pluginData } from "@/features/thread-list";
import type { RpcContract } from "@/shared/contract";
import { createAutosave, type Autosave, type AutosaveState } from "./model/autosave";

export const SAVE_FAILED_TOAST = "Could not save sidebar settings";

export function useAutosave(): { autosave: Autosave; state: AutosaveState } {
  const rpc = useRpc<RpcContract>();
  const latest = useRef(rpc);
  latest.current = rpc;
  const [autosave] = useState(() =>
    createAutosave({
      current: () => pluginData.settings(),
      write: async (patch) => {
        pluginData.settingsSignal(await latest.current.call("writeSettings", { patch }));
      },
      failed: () => void toast.error(SAVE_FAILED_TOAST),
    }),
  );
  const state = useSyncExternalStore(autosave.subscribe, autosave.state);
  useEffect(() => {
    const leave = () => void autosave.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [autosave]);
  return { autosave, state };
}
