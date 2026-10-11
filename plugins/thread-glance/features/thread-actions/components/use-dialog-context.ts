// What the dialogs read of bb and the plugin server while one is open: the
// threads and projects bb lists, and the lifecycle commands gated on the
// thread as bb lists it when the command runs.
import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LifecycleCommands } from "@/features/thread-list";
import { useLifecycleCommands } from "../use-lifecycle-commands";

export interface DialogContext {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  commands: LifecycleCommands;
}

export function useDialogContext(): DialogContext {
  const sidebar = useSidebarThreads();
  const commands = useLifecycleCommands(sidebar.threads);
  return { threads: sidebar.threads, projects: sidebar.projects, commands };
}
