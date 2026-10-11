// What the dialogs read of bb and the plugin server while one is open: the
// threads and projects bb lists, and the lifecycle commands gated on the
// thread as bb lists it when the command runs.
import { useMemo, useRef } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { createLifecycleCommands, lifecycleHostOf, type LifecycleCommands } from "@/features/thread-list";
import type { RpcContract } from "@/shared/contract";

export interface DialogContext {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  commands: LifecycleCommands;
}

export function useDialogContext(): DialogContext {
  const rpc = useRpc<RpcContract>();
  const sidebar = useSidebarThreads();
  const latest = useRef(sidebar.threads);
  latest.current = sidebar.threads;
  const commands = useMemo(
    () => createLifecycleCommands(lifecycleHostOf(rpc, (id) => latest.current.find((thread) => thread.id === id) ?? null)),
    [rpc],
  );
  return { threads: sidebar.threads, projects: sidebar.projects, commands };
}
