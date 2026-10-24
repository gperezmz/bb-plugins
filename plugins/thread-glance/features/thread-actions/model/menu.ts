// The thread menu's actions for one thread, as bb's menu shows them: which
// ones apply, their labels and choice lists, and what running one does. Pure:
// the registrations hand in the thread, the data the window holds and the
// ports that reach the dialogs and the clipboard.
import type { PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import type { LifecycleCommands } from "@/features/thread-list";
import { resolveSnoozePreset, snoozeChoices, TIME_PASSED_REASON, type SnoozePreset } from "@/shared/snooze";
import type { MenuFacts } from "./facts";
import { isParentNotifications, NOTIFY_CHOICES, type NotifyState } from "./notify";

/** What the project actions that open a dialog can ask for. */
export type ProjectDialogKind = "rename" | "add-path" | "remove";

/** Where an action reaches outside the menu: the dialogs, the clipboard, bb's pages and its toasts. */
export interface MenuPorts {
  requestSnoozePicker(threadId: string): void;
  requestParent(threadId: string): void;
  requestProject(kind: ProjectDialogKind, projectId: string): void;
  /** Opens bb's page at the app-relative `href`. */
  openPage(href: string): void;
  copy(text: string, success: string): void;
  refuse(message: string): void;
}

/** A project as the menu needs it. */
export interface MenuProject {
  name: string;
  isPersonal: boolean;
  settingsHref: string;
}

/** Whether the machines a local path can be added on could be listed. */
export type MachinesState = "loading" | "failed" | { count: number };

/** What the window holds that the menu reads. */
export interface MenuData {
  /** The clock the presets and Woke markers are read at, epoch ms, moved on every minute. */
  now: number;
  facts: ReadonlyMap<string, MenuFacts>;
  projects: ReadonlyMap<string, MenuProject>;
  presets: readonly SnoozePreset[];
  machines: MachinesState;
  commands: LifecycleCommands;
  notify: NotifyState;
  ports: MenuPorts;
}

/** The choice ids of the Snooze list and the Project list. */
export const PICK_CHOICE = "pick";
export const PRESET_PREFIX = "preset:";
export const PROJECT_CHOICES = {
  settings: "settings",
  rename: "rename",
  addPath: "add-path",
  remove: "remove",
} as const;
export const MACHINES_FAILED = "Could not load machines";

type Builder = (thread: PluginThreadActionTarget, data: MenuData) => PluginThreadAction | null;

/** The facts of a thread the lifecycle actions may be offered for, or null for an archived or unknown thread. */
function lifecycleFacts(thread: PluginThreadActionTarget, data: MenuData): MenuFacts | null {
  if (thread.archivedAt !== null) return null;
  return data.facts.get(thread.id) ?? null;
}

export const parentAction: Builder = (thread, data) => ({
  label: "Parent…",
  icon: "CornerDownRight",
  run: () => data.ports.requestParent(thread.id),
});

export const projectAction: Builder = (thread, data) => {
  const project = data.projects.get(thread.projectId);
  if (project === undefined || project.isPersonal) return null;
  const showPath = data.machines === "failed" || data.machines === "loading" || data.machines.count > 0;
  const items = [
    { id: PROJECT_CHOICES.settings, label: "Project settings", icon: "Settings" },
    { id: PROJECT_CHOICES.rename, label: "Rename project", icon: "Edit" },
    ...(showPath ? [{ id: PROJECT_CHOICES.addPath, label: "Add local path", icon: "FolderPlus", disabled: data.machines === "failed" }] : []),
    { id: PROJECT_CHOICES.remove, label: "Remove project", icon: "Trash2" },
  ];
  return {
    label: "Project",
    icon: "Folder",
    choices: { heading: project.name, items, ...(data.machines === "failed" && showPath ? { hint: MACHINES_FAILED } : {}) },
    run: ({ value }) => {
      if (value === PROJECT_CHOICES.settings) data.ports.openPage(project.settingsHref);
      else if (value === PROJECT_CHOICES.rename) data.ports.requestProject("rename", thread.projectId);
      else if (value === PROJECT_CHOICES.addPath) data.ports.requestProject("add-path", thread.projectId);
      else if (value === PROJECT_CHOICES.remove) data.ports.requestProject("remove", thread.projectId);
    },
  };
};

export const snoozeAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.busy || facts.woke) return null;
  const choices = snoozeChoices(data.presets, new Date(data.now));
  const someHavePassed = choices.some((choice) => choice.disabledReason !== null);
  return {
    label: "Snooze",
    icon: "Clock",
    choices: {
      heading: "Snooze",
      items: [
        ...choices.map((choice) => ({
          id: `${PRESET_PREFIX}${choice.preset.id}`,
          label: choice.preset.label,
          disabled: choice.disabledReason !== null,
        })),
        { id: PICK_CHOICE, label: "Pick date & time…", icon: "Calendar" },
      ],
      ...(someHavePassed ? { hint: TIME_PASSED_REASON } : {}),
    },
    run: ({ value }) => {
      if (value === PICK_CHOICE) {
        data.ports.requestSnoozePicker(thread.id);
        return;
      }
      const preset = data.presets.find((candidate) => `${PRESET_PREFIX}${candidate.id}` === value);
      if (preset === undefined) return;
      // The wake time is resolved when the choice is picked: the menu may have been open a while.
      const until = resolveSnoozePreset(preset, new Date());
      if (until === null) data.ports.refuse(TIME_PASSED_REASON);
      else return data.commands.snooze(thread.id, until);
    },
  };
};

export const wakeAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.mark !== "snoozed") return null;
  return { label: "Wake now", icon: "RotateCcw", run: () => data.commands.wakeNow(thread.id) };
};

export const parkAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.busy || facts.mark === "parked") return null;
  return { label: "Park thread", icon: "thread-glance-car", run: () => data.commands.park(thread.id) };
};

export const resumeAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.mark !== "parked") return null;
  return { label: "Resume", icon: "Play", run: () => data.commands.resume(thread.id) };
};

export const settleAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.busy || facts.mark === "settled") return null;
  return { label: "Settle", icon: "thread-glance-meditation", run: () => data.commands.settle(thread.id) };
};

export const unsettleAction: Builder = (thread, data) => {
  const facts = lifecycleFacts(thread, data);
  if (facts === null || facts.mark !== "settled") return null;
  return { label: "Un-settle", icon: "Undo", run: () => data.commands.unsettle(thread.id) };
};

export const notifyParentAction: Builder = (thread, data) => {
  if (data.facts.get(thread.id)?.notifiable !== true) return null;
  const current = data.notify.values.get(thread.id);
  const currentLabel = NOTIFY_CHOICES.find((choice) => choice.id === current)?.label;
  return {
    label: "Notify parent",
    icon: "BellDot",
    ...(currentLabel === undefined ? {} : { detail: currentLabel }),
    choices: {
      heading: "Notify parent",
      items: NOTIFY_CHOICES.map((choice) => ({ id: choice.id, label: choice.label, selected: choice.id === current })),
    },
    run: ({ value }) => {
      // The pick is written even when it is the value shown: the menu's value may be older than bb's.
      if (!isParentNotifications(value)) return;
      return data.notify.set(thread.id, value);
    },
  };
};

export const copyBranchAction: Builder = (thread, data) => {
  const branch = data.facts.get(thread.id)?.branch ?? null;
  if (branch === null) return null;
  return { label: "Copy branch", icon: "GitBranch", run: () => data.ports.copy(branch, "Branch copied") };
};

export const copyThreadIdAction: Builder = (thread, data) => ({
  label: "Copy thread ID",
  icon: "Copy",
  run: () => data.ports.copy(thread.id, "Thread ID copied"),
});
