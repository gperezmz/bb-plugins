// What a user's click on a chip, fold or header changes.
// Pure: returns the preference patch and which auto-expand targets to drop.
import type { Preferences } from "@/shared/preferences";
import { ancestorsOf, type Family, type Forest } from "./families";
import { isGroupCollapsed, toggleGroupCollapse } from "./groups";
import { isDoneUnseen } from "./state";
import type { GroupView, OlderRow, ThreadRow } from "./view";

export interface ToggleOutcome {
  patch: Partial<Preferences>;
  /** Targets to drop so the collapse sticks until the next transition. */
  drop: ((id: string) => boolean) | null;
}

function without(list: readonly string[], value: string): string[] {
  return list.filter((item) => item !== value);
}

function under(forest: Forest, parentId: string): (id: string) => boolean {
  return (id) => ancestorsOf(id, forest.infos).includes(parentId);
}

export function toggleChip(row: ThreadRow, prefs: Preferences, forest: Forest): ToggleOutcome {
  const id = row.info.thread.id;
  const expanded = row.chip?.expanded ?? false;
  // Expanding shows every child; collapsing also drops auto-reveals.
  return expanded
    ? { patch: { expandedChildren: without(prefs.expandedChildren, id) }, drop: under(forest, id) }
    : { patch: { expandedChildren: [...without(prefs.expandedChildren, id), id] }, drop: null };
}

export function toggleOlder(row: OlderRow, prefs: Preferences, group: GroupView | null, forest: Forest): ToggleOutcome {
  if (row.scope === "reveal") {
    // "+N more" expands the whole family, as the chip does.
    return { patch: { expandedChildren: [...without(prefs.expandedChildren, row.scopeId), row.scopeId] }, drop: null };
  }
  if (!row.expanded) {
    return { patch: { expandedOlder: [...without(prefs.expandedOlder, row.scopeId), row.scopeId] }, drop: null };
  }
  const patch = { expandedOlder: without(prefs.expandedOlder, row.scopeId) };
  if (row.scope === "family") return { patch, drop: under(forest, row.scopeId) };
  // Folding a group's older roots drops the targets that held it open.
  const quietRoots = new Set<string>();
  for (const family of forest.families) if (family.quietIgnoringOpen) quietRoots.add(family.root.thread.id);
  const inGroup = new Set(group?.rootIds ?? []);
  return {
    patch,
    drop: (id) => {
      const family = forest.familyOf.get(id);
      return family !== undefined && quietRoots.has(family.root.thread.id) && inGroup.has(family.root.thread.id);
    },
  };
}

export function toggleGroup(group: GroupView, prefs: Preferences, forest: Forest): ToggleOutcome {
  const inGroup = new Set(group.rootIds);
  const dropGroup = (id: string) => {
    const family = forest.familyOf.get(id);
    return family !== undefined && inGroup.has(family.root.thread.id);
  };
  if (group.collapsed) {
    return {
      patch: isGroupCollapsed(group.descriptor, prefs) ? toggleGroupCollapse(group.descriptor, prefs) : {},
      drop: null,
    };
  }
  // Open only because a target opened it: collapsing drops the targets.
  if (group.userCollapsed) return { patch: {}, drop: dropGroup };
  return { patch: toggleGroupCollapse(group.descriptor, prefs), drop: dropGroup };
}

export interface MarkAllRead {
  /** Threads bb's rule calls unread: `actions.setRead(id, true)`. */
  read: string[];
  /** Done-unseen children: stamp `seenAt`. */
  seen: string[];
}

/** Every unread thread in the families, descendants included. */
export function markAllReadPlan(
  families: readonly Family[],
  context: { activeThreadId: string | null; finishedAt: Readonly<Record<string, number>>; seenAt: Readonly<Record<string, number>> },
): MarkAllRead {
  const read: string[] = [];
  const seen: string[] = [];
  for (const family of families) {
    for (const info of [family.root, ...family.descendants]) {
      if (!info.unread || info.thread.isArchived) continue;
      read.push(info.thread.id);
      if (isDoneUnseen(info.thread, context)) seen.push(info.thread.id);
    }
  }
  return { read, seen };
}
