// Auto-expansion: transitions found by diffing snapshots, and the
// transient targets they leave behind. Pure.
import { revealsOn } from "./needs-you";
import type { Forest } from "./families";

/**
 * `reveal` targets open their group, their `N older` fold and the parent
 * chips on their path. `open` targets (a thread that newly became unread)
 * open the group and the fold only, so finished children don't expand
 * their parent's chip.
 */
export type TargetKind = "reveal" | "open";
export type Targets = ReadonlyMap<string, TargetKind>;

export interface Snapshot {
  activeThreadId: string | null;
  unread: ReadonlySet<string>;
  /** Threads that wait on you or failed, as Needs you counts them. */
  needsYou: ReadonlySet<string>;
}

export function snapshotOf(forest: Forest, activeThreadId: string | null): Snapshot {
  const unread = new Set<string>();
  const needsYou = new Set<string>();
  for (const info of forest.infos.values()) {
    if (info.thread.isArchived) continue;
    // A finished child that does not need you never opens anything.
    if (info.needsYou.has("unread") && !info.thread.isHidden) unread.add(info.thread.id);
    if (revealsOn(info.needsYou, info.parentId === null)) needsYou.add(info.thread.id);
  }
  return { activeThreadId, unread, needsYou };
}

/**
 * The targets a render adds. `previous` is null on the first
 * render, which counts as a transition.
 */
export function detectTransitions(previous: Snapshot | null, next: Snapshot): Map<string, TargetKind> {
  const found = new Map<string, TargetKind>();
  if (next.activeThreadId !== null && next.activeThreadId !== previous?.activeThreadId) {
    found.set(next.activeThreadId, "reveal");
  }
  for (const id of next.needsYou) {
    if (!previous?.needsYou.has(id)) found.set(id, "reveal");
  }
  for (const id of next.unread) {
    if (id === next.activeThreadId || found.has(id)) continue;
    if (!previous?.unread.has(id)) found.set(id, "open");
  }
  return found;
}

export function mergeTargets(current: Targets, added: ReadonlyMap<string, TargetKind>): Targets {
  if (added.size === 0) return current;
  const next = new Map(current);
  for (const [id, kind] of added) {
    if (next.get(id) !== "reveal") next.set(id, kind);
  }
  return next;
}

/** Drops targets for which `drop` returns true (a user's collapse). */
export function pruneTargets(current: Targets, drop: (id: string) => boolean): Targets {
  let changed = false;
  const next = new Map<string, TargetKind>();
  for (const [id, kind] of current) {
    if (drop(id)) changed = true;
    else next.set(id, kind);
  }
  return changed ? next : current;
}
