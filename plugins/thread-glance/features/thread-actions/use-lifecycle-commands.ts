// The lifecycle commands for code that runs outside the list: the thread menu
// and the dialogs. Their busy gate reads the thread as bb lists it when a
// command runs, not as it was when the menu or dialog was drawn.
import { useMemo, useRef } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createLifecycleCommands, lifecycleHostOf, treeHasBusy, waitingChildTitle, type LifecycleCommands } from "@/features/thread-list";
import type { RpcContract } from "@/shared/contract";

export function useLifecycleCommands(threads: readonly PluginSidebarThread[]): LifecycleCommands {
  const rpc = useRpc<RpcContract>();
  const latest = useRef(threads);
  latest.current = threads;
  return useMemo(
    () =>
      createLifecycleCommands(
        lifecycleHostOf(
          rpc,
          (id) => latest.current.find((thread) => thread.id === id) ?? null,
          (id) => waitingChildTitle(latest.current, id),
          (id) => treeHasBusy(latest.current, id),
        ),
      ),
    [rpc],
  );
}
