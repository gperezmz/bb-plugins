// What a user's click on a chip, fold or header changes.
// Pure: returns the preference patch and which auto-expand targets to drop.
import type { Preferences } from "@/shared/preferences";
import { ancestorsOf, type ThreadTree, type Forest } from "./trees";
import { isGroupCollapsed, toggleGroupCollapse } from "./groups";
import { isDoneUnseen } from "./state";
import type { GroupView, OlderRow, SettledRow, ThreadRow } from "./view";

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
    : openChildren(id, prefs);
}

/** Opens a parent's children, as its chip does, from an auto-reveal's fold. */
export function openChildren(parentId: string, prefs: Preferences): ToggleOutcome {
  return { patch: { expandedChildren: [...without(prefs.expandedChildren, parentId), parentId] }, drop: null };
}

/** Opens or closes an open tree's "N more child threads" fold. */
export function toggleOlder(row: OlderRow, prefs: Preferences, forest: Forest): ToggleOutcome {
  if (row.scope === "reveal") return openChildren(row.scopeId, prefs);
  if (!row.expanded) {
    return { patch: { expandedOlder: [...without(prefs.expandedOlder, row.scopeId), row.scopeId] }, drop: null };
  }
  return { patch: { expandedOlder: without(prefs.expandedOlder, row.scopeId) }, drop: under(forest, row.scopeId) };
}

/** Opens or closes a group's settled fold. */
export function toggleSettled(row: SettledRow, prefs: Preferences): ToggleOutcome {
  const rest = without(prefs.openSettledFolds, row.groupId);
  return { patch: { openSettledFolds: row.expanded ? rest : [...rest, row.groupId] }, drop: null };
}

export function toggleGroup(group: GroupView, prefs: Preferences, forest: Forest): ToggleOutcome {
  const inGroup = new Set(group.rootIds);
  const dropGroup = (id: string) => {
    const tree = forest.treeOf.get(id);
    return tree !== undefined && inGroup.has(tree.root.thread.id);
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

/** Every unread thread in the trees, descendants included: Mark all read, and a root's Mark read for its tree. */
export function markAllReadPlan(
  trees: readonly ThreadTree[],
  context: { activeThreadId: string | null; finishedAt: Readonly<Record<string, number>>; seenAt: Readonly<Record<string, number>> },
): MarkAllRead {
  const read: string[] = [];
  const seen: string[] = [];
  for (const tree of trees) {
    for (const info of [tree.root, ...tree.descendants]) {
      if (!info.unread || info.thread.isArchived) continue;
      read.push(info.thread.id);
      if (isDoneUnseen(info.thread, context)) seen.push(info.thread.id);
    }
  }
  return { read, seen };
}

/**
 * What one row's Mark read marks: on a tree's root, every unread thread in
 * the tree; on any other row, the thread alone.
 */
export function markReadPlanFor(
  threadId: string,
  forest: Pick<Forest, "infos" | "treeOf">,
  context: { activeThreadId: string | null; finishedAt: Readonly<Record<string, number>>; seenAt: Readonly<Record<string, number>> },
): MarkAllRead {
  const tree = forest.treeOf.get(threadId);
  if (tree !== undefined && tree.root.thread.id === threadId) return markAllReadPlan([tree], context);
  const thread = forest.infos.get(threadId)?.thread;
  if (thread === undefined) return { read: [threadId], seen: [] };
  return { read: [threadId], seen: isDoneUnseen(thread, context) ? [threadId] : [] };
}
