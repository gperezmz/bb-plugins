// "Move…": the keyboard route to what drag and drop does. Pure.
import type { Forest } from "./families";
import { isInSubtree } from "./drag";

export interface MoveTarget {
  /** null moves the thread to the top level. */
  parentThreadId: string | null;
  label: string;
  /** For the list: the parent's own parent, so nested targets read in context. */
  detail: string | null;
}

/**
 * Where a thread can move: the top level (when it has a parent) and under
 * any other visible, active thread outside its own subtree, best matches
 * of `query` first. The current parent is left out: moving there changes
 * nothing.
 */
export function moveTargets(threadId: string, forest: Forest, query = "", limit = 50): MoveTarget[] {
  const self = forest.infos.get(threadId);
  if (self === undefined) return [];
  const parentOf = (id: string) => forest.infos.get(id)?.thread.parentThreadId ?? null;
  const needle = query.trim().toLowerCase();
  const targets: MoveTarget[] = [];
  if (self.thread.parentThreadId !== null && (needle === "" || "top level".includes(needle))) {
    targets.push({ parentThreadId: null, label: "Top level", detail: "No parent thread" });
  }
  const candidates = [...forest.infos.values()]
    .filter((info) => {
      const thread = info.thread;
      if (thread.isHidden || thread.isArchived) return false;
      if (thread.id === self.thread.parentThreadId) return false;
      if (isInSubtree(thread.id, threadId, parentOf)) return false;
      return needle === "" || thread.displayTitle.toLowerCase().includes(needle);
    })
    .sort((a, b) => b.thread.latestAttentionAt - a.thread.latestAttentionAt);
  for (const info of candidates.slice(0, limit)) {
    const parent = info.parentId === null ? null : forest.infos.get(info.parentId);
    targets.push({
      parentThreadId: info.thread.id,
      label: info.thread.displayTitle,
      detail: parent ? `in ${parent.thread.displayTitle}` : null,
    });
  }
  return targets;
}
