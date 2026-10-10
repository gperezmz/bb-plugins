// Top-level groups: which group a tree lands in, and the order
// groups appear in. Pure.
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { OrganizationMode, Preferences } from "@/shared/preferences";

type GroupKind = "pinned" | "threads" | "project" | "section" | "machine";

export interface GroupDescriptor {
  /** `pinned`, `threads`, `project:<id>`, `section:<id>` or `machine:<id>`. */
  id: string;
  kind: GroupKind;
  label: string;
  /** Project, section or machine id for entity groups. */
  entityId: string | null;
  /** What a new thread started from this group's `+` is given. */
  newThread: NewThreadTarget;
}

/**
 * What bb's compose screen is opened with: the project, where the thread is
 * filed and pinned, and the machine a new environment runs on. A key left out
 * is left to bb's defaults.
 */
export interface NewThreadTarget {
  projectId?: string;
  placement?: { sectionId: string | null; pinned: boolean };
  hostId?: string;
}

export interface GroupingInputs {
  mode: OrganizationMode;
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  threads: readonly PluginSidebarThread[];
}

export const PINNED_GROUP_ID = "pinned";
export const THREADS_GROUP_ID = "threads";

/** The thread is pinned. */
export function isPinnedThread(thread: PluginSidebarThread): boolean {
  return thread.pinnedAt !== null || thread.isPinned;
}

/** The personal project the loose Threads bucket stands for in project mode. */
function personalProject(
  projects: readonly PluginSidebarProject[],
): PluginSidebarProject | null {
  return projects.find((project) => project.isPersonal) ?? null;
}

/**
 * The group a tree root belongs to. Pinned roots go to Pinned. A root
 * whose project, section or machine isn't known goes to the loose Threads
 * bucket, except an unknown section, which gets a placeholder group as in
 * bb.
 */
export function groupIdForRoot(
  root: PluginSidebarThread,
  inputs: Pick<GroupingInputs, "mode" | "projects">,
): string {
  if (isPinnedThread(root) && !root.isHidden) return PINNED_GROUP_ID;
  switch (inputs.mode) {
    case "project": {
      const project = inputs.projects.find((candidate) => candidate.id === root.projectId);
      if (project === undefined || project.isPersonal) return THREADS_GROUP_ID;
      return `project:${project.id}`;
    }
    case "chronological":
      return root.sectionId === null ? THREADS_GROUP_ID : `section:${root.sectionId}`;
    case "machine":
      return root.host === null ? THREADS_GROUP_ID : `machine:${root.host.id}`;
  }
}

/** A thread started in a section: filed there, unpinned, in the personal project. */
function sectionTarget(personal: PluginSidebarProject | null, sectionId: string): NewThreadTarget {
  return {
    ...(personal === null ? {} : { projectId: personal.id }),
    placement: { sectionId, pinned: false },
  };
}

/** Entity groups for the mode, in their natural order. */
export function entityGroups(
  inputs: GroupingInputs,
  alphabetical: boolean,
): GroupDescriptor[] {
  const personal = personalProject(inputs.projects);
  switch (inputs.mode) {
    case "project":
      return inputs.projects
        .filter((project) => !project.isPersonal)
        .map((project) => ({
          id: `project:${project.id}`,
          kind: "project" as const,
          label: project.name,
          entityId: project.id,
          newThread: { projectId: project.id },
        }));
    case "chronological": {
      const known = new Set(inputs.sections.map((section) => section.id));
      const sections = [...inputs.sections];
      if (alphabetical) sections.sort((a, b) => a.name.localeCompare(b.name));
      const groups: GroupDescriptor[] = sections.map((section) => ({
        id: `section:${section.id}`,
        kind: "section",
        label: section.name,
        entityId: section.id,
        newThread: sectionTarget(personal, section.id),
      }));
      for (const thread of inputs.threads) {
        if (thread.sectionId === null || known.has(thread.sectionId)) continue;
        known.add(thread.sectionId);
        groups.push({
          id: `section:${thread.sectionId}`,
          kind: "section",
          label: "Section",
          entityId: thread.sectionId,
          newThread: sectionTarget(personal, thread.sectionId),
        });
      }
      return groups;
    }
    case "machine": {
      const seen = new Map<string, string>();
      for (const thread of inputs.threads) {
        if (thread.host !== null && !seen.has(thread.host.id)) {
          seen.set(thread.host.id, thread.host.name);
        }
      }
      return [...seen].map(([id, name]) => ({
        id: `machine:${id}`,
        kind: "machine" as const,
        label: name || "Unknown machine",
        entityId: id,
        newThread: { hostId: id },
      }));
    }
  }
}

export function builtinGroup(
  id: typeof PINNED_GROUP_ID | typeof THREADS_GROUP_ID,
  projects: readonly PluginSidebarProject[],
): GroupDescriptor {
  if (id === PINNED_GROUP_ID) {
    return {
      id,
      kind: "pinned",
      label: "Pinned",
      entityId: null,
      newThread: { placement: { sectionId: null, pinned: true } },
    };
  }
  const personal = personalProject(projects);
  return {
    id,
    kind: "threads",
    label: "Threads",
    entityId: null,
    newThread: personal === null ? {} : { projectId: personal.id },
  };
}

const ANCHORS: Record<OrganizationMode, string> = {
  project: "projects",
  chronological: "sections",
  machine: "machines",
};

export const ORDER_PREFERENCE: Record<
  OrganizationMode,
  "sectionOrder" | "manualSectionOrder" | "machineSectionOrder"
> = {
  project: "sectionOrder",
  chronological: "manualSectionOrder",
  machine: "machineSectionOrder",
};

/**
 * Resolves the stored top-level order for a mode: the legacy anchor
 * (`projects`, `sections`, `machines`) expands to the entity ids, unknown
 * ids are dropped, and entities missing from the stored order are spliced
 * in after the last entity group. Pinned and Threads are always present.
 */
export function resolveGroupOrder(
  mode: OrganizationMode,
  stored: readonly string[],
  entityIds: readonly string[],
): string[] {
  const anchor = ANCHORS[mode];
  const entities = new Set(entityIds);
  const explicit = new Set(stored);
  const out: string[] = [];
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const id of stored) {
    if (id === anchor) {
      for (const entity of entityIds) if (!explicit.has(entity)) push(entity);
    } else if (id === PINNED_GROUP_ID || id === THREADS_GROUP_ID || entities.has(id)) {
      push(id);
    }
  }
  const missing = entityIds.filter((id) => !out.includes(id));
  if (missing.length > 0) {
    let lastEntity = -1;
    out.forEach((id, index) => {
      if (entities.has(id)) lastEntity = index;
    });
    const insertAt =
      lastEntity >= 0
        ? lastEntity + 1
        : out.includes(THREADS_GROUP_ID)
          ? out.indexOf(THREADS_GROUP_ID)
          : out.length;
    out.splice(insertAt, 0, ...missing);
  }
  if (!out.includes(PINNED_GROUP_ID)) out.unshift(PINNED_GROUP_ID);
  if (!out.includes(THREADS_GROUP_ID)) out.push(THREADS_GROUP_ID);
  return out;
}

/** Moves `id` before or after `targetId` in an order (header drag). */
export function moveGroup(
  order: readonly string[],
  id: string,
  targetId: string,
  placement: "before" | "after",
): string[] {
  if (id === targetId) return [...order];
  const without = order.filter((candidate) => candidate !== id);
  const index = without.indexOf(targetId);
  if (index < 0) return [...order];
  without.splice(placement === "before" ? index : index + 1, 0, id);
  return without;
}

/** The collapse state of a group, from bb's per-kind collapsed sets. */
export function isGroupCollapsed(group: GroupDescriptor, prefs: Preferences): boolean {
  switch (group.kind) {
    case "pinned":
    case "threads":
      return (prefs.collapsedSections as readonly string[]).includes(group.kind);
    case "project":
      return prefs.collapsedProjects.includes(group.entityId!);
    case "section":
      return prefs.collapsedThreadSections.includes(group.id);
    case "machine":
      return prefs.collapsedMachines.includes(group.entityId!);
  }
}

/** The preference change that toggles a group's collapse. */
export function toggleGroupCollapse(
  group: GroupDescriptor,
  prefs: Preferences,
): Partial<Preferences> {
  const toggle = <T extends string>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  switch (group.kind) {
    case "pinned":
    case "threads":
      return { collapsedSections: toggle(prefs.collapsedSections, group.kind) };
    case "project":
      return { collapsedProjects: toggle(prefs.collapsedProjects, group.entityId!) };
    case "section":
      return { collapsedThreadSections: toggle(prefs.collapsedThreadSections, group.id) };
    case "machine":
      return { collapsedMachines: toggle(prefs.collapsedMachines, group.entityId!) };
  }
}

/** Projects, sections and machines take a name of their own. */
export function canRename(descriptor: GroupDescriptor): boolean {
  return descriptor.kind === "project" || descriptor.kind === "section" || descriptor.kind === "machine";
}
