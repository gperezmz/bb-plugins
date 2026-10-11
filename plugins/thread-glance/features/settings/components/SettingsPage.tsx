// Thread Glance's settings, in bb's settings section for the plugin: a heading
// with the save status, a strip that jumps to each group, and the six groups.
// Every change saves by itself (see model/autosave.ts).
import { useMemo } from "react";
import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useServerSettings } from "@/features/thread-list";
import type { SaveStatus } from "../model/autosave";
import { shownSettings } from "../model/edits";
import { useAutosave } from "../use-autosave";
import type { Form } from "./form";
import { ProjectAppearance } from "./ProjectAppearance";
import { ProjectManagement } from "./ProjectManagement";
import { ChildThreads, SidebarLayout, ThreadBehavior } from "./SettingsGroups";
import { ThisDevice } from "./ThisDevice";

/** The groups, in page order: the strip's buttons and the headings they jump to. */
export const GROUPS = [
  { id: "tg-sidebar-layout", title: "Sidebar layout" },
  { id: "tg-project-appearance", title: "Project appearance" },
  { id: "tg-thread-behavior", title: "Thread behavior" },
  { id: "tg-child-threads", title: "Child threads" },
  { id: "tg-this-device", title: "This device" },
  { id: "tg-project-management", title: "Project management" },
] as const;

const STATUS_TEXT: Record<SaveStatus, string> = { idle: "", saving: "Saving…", saved: "Saved", failed: "Not saved" };

export function SettingsPage() {
  const server = useServerSettings();
  const { autosave, state } = useAutosave();
  const { projects } = useSidebarThreads();
  const form: Form = useMemo(
    () => ({ values: shownSettings(server, state.edits), errors: state.errors, edit: autosave.edit }),
    [server, state, autosave],
  );
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-foreground">Thread Glance</h2>
        <p role="status" aria-live="polite" className="text-xs text-subtle-foreground">
          {STATUS_TEXT[state.status]}
        </p>
      </div>
      <nav aria-label="Settings groups" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 bg-background/90 px-1 py-1 backdrop-blur">
        {GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => document.getElementById(group.id)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
            className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {group.title}
          </button>
        ))}
      </nav>
      <SidebarLayout form={form} />
      <ProjectAppearance form={form} projects={projects} />
      <ThreadBehavior form={form} />
      <ChildThreads form={form} />
      <ThisDevice />
      <ProjectManagement projects={projects} />
    </div>
  );
}
