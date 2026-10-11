// Builders the thread actions' tests share: a thread as bb's menu hands it
// over, and the data the menu reads.
import type { PluginSidebarThread, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { vi } from "vitest";
import type { LifecycleCommands } from "@/features/thread-list";
import type { LifecycleRow } from "@/shared/lifecycle";
import { readSnoozePresets } from "@/shared/snooze";
import { menuFactsOf } from "./facts";
import type { MenuData, MenuPorts, MenuProject } from "./menu";

export function targetOf(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: thread.environment === null ? null : { id: thread.environment.id ?? "", path: thread.environment.path },
  };
}

export function fakeCommands(): { [K in keyof LifecycleCommands]: ReturnType<typeof vi.fn> } {
  return {
    snooze: vi.fn(async () => {}),
    wakeNow: vi.fn(async () => {}),
    park: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
    unsettle: vi.fn(async () => {}),
    dismissWoke: vi.fn(async () => {}),
    clearPinned: vi.fn(async () => {}),
  };
}

export function fakePorts(): { [K in keyof MenuPorts]: ReturnType<typeof vi.fn> } {
  return {
    requestSnoozePicker: vi.fn(),
    requestParent: vi.fn(),
    requestProject: vi.fn(),
    openPage: vi.fn(),
    copy: vi.fn(),
    refuse: vi.fn(),
  };
}

export const PROJECT_MAP: ReadonlyMap<string, MenuProject> = new Map([
  ["proj_a", { name: "Alpha", isPersonal: false, settingsHref: "/projects/proj_a/settings" }],
  ["proj_personal", { name: "Personal", isPersonal: true, settingsHref: "/projects/proj_personal/settings" }],
]);

export interface DataOptions {
  now?: number;
  presets?: string;
  rows?: Record<string, LifecycleRow>;
  machines?: MenuData["machines"];
}

/** The menu's data for `threads`, with fake commands and ports. */
export function menuData(threads: readonly PluginSidebarThread[], options: DataOptions = {}) {
  const now = options.now ?? Date.now();
  const commands = fakeCommands();
  const ports = fakePorts();
  const data: MenuData = {
    now,
    facts: new Map(threads.map((thread) => [thread.id, menuFactsOf(thread, options.rows?.[thread.id] ?? null, now)])),
    projects: PROJECT_MAP,
    presets: readSnoozePresets(options.presets ?? ""),
    machines: options.machines ?? { count: 1 },
    commands: commands as unknown as LifecycleCommands,
    ports: ports as unknown as MenuPorts,
  };
  return { data, commands, ports };
}
