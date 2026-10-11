// The data the thread menu's actions read, held once for the whole app: bb
// calls a registration's `useData` once, not per thread or per menu.
import { useMemo, useRef } from "react";
import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadActionDataInput } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { requestSnoozePicker, useLifecycleRows, useServerSettings } from "@/features/thread-list";
import { readSnoozePresets } from "@/shared/snooze";
import { menuFactsOf, shareFacts, type MenuFacts } from "./model/facts";
import type { MenuData, MenuPorts, MenuProject } from "./model/menu";
import { useMachines, useMinuteClock } from "./window-state";
import { useLifecycleCommands } from "./use-lifecycle-commands";
import { requestParentDialog, requestProjectDialog } from "./requests";

const NO_FACTS: ReadonlyMap<string, MenuFacts> = new Map();

/** Opens `href` (an app-relative URL) in bb. */
function openPage(openUrl: (url: string) => boolean, href: string): void {
  const url = new URL(href, window.location.origin).href;
  if (!openUrl(url)) window.open(url, "_blank", "noopener");
}

const ports: Omit<MenuPorts, "openPage"> = {
  requestSnoozePicker,
  requestParent: requestParentDialog,
  requestProject: requestProjectDialog,
  copy(text, success) {
    copyToClipboard({ text }).then(
      (copied) => (copied ? toast.success(success) : toast.error("Could not copy to the clipboard")),
      () => toast.error("Could not copy to the clipboard"),
    );
  },
  refuse: (message) => void toast.error(message),
};

/**
 * The registrations' shared `useData`. The result keeps its identity until
 * something a menu reads changes, so one thread's turn does not re-evaluate
 * every menu.
 */
export function useMenuData({ threadIds }: PluginThreadActionDataInput): MenuData {
  const navigate = useBbNavigate();
  const sidebar = useSidebarThreads();
  const rows = useLifecycleRows();
  const settings = useServerSettings();
  const now = useMinuteClock();
  const machines = useMachines(useSdk());

  const byId = useMemo(() => new Map(sidebar.threads.map((thread) => [thread.id, thread])), [sidebar.threads]);
  // bb's navigation changes identity on every host update; the page opens through the current one.
  const navigation = useRef(navigate);
  navigation.current = navigate;
  const commands = useLifecycleCommands(sidebar.threads);

  const factsRef = useRef(NO_FACTS);
  const facts = useMemo(() => {
    const next = new Map<string, MenuFacts>();
    for (const id of threadIds) {
      const thread = byId.get(id);
      if (thread !== undefined) next.set(id, menuFactsOf(thread, rows[id] ?? null, now));
    }
    return shareFacts(factsRef.current, next);
  }, [threadIds, byId, rows, now]);
  factsRef.current = facts;

  const projects = useMemo(() => {
    const map = new Map<string, MenuProject>();
    for (const project of sidebar.projects) {
      map.set(project.id, { name: project.name, isPersonal: project.isPersonal, settingsHref: project.settingsHref });
    }
    return map;
  }, [sidebar.projects]);
  const presets = useMemo(() => readSnoozePresets(settings.snoozeShortcuts), [settings.snoozeShortcuts]);

  return useMemo<MenuData>(
    () => ({
      now,
      facts,
      projects,
      presets,
      machines,
      commands,
      ports: { ...ports, openPage: (href) => openPage(navigation.current.openUrl, href) },
    }),
    [now, facts, projects, presets, machines, commands],
  );
}
