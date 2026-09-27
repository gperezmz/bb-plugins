/**
 * Keep warm while waiting: the switch on each tree top, and whether a thread
 * tree gets keep-warms.
 *
 * A tree top is a Claude Code thread with no Claude Code thread above it, so
 * a tree whose root is not a Claude Code thread has one per Claude Code
 * branch. Its switch covers it and every thread below it. A tree top nobody
 * flipped follows the "Keep caches warm while waiting" setting; a flipped one
 * keeps what was recorded, except under Never, which sends none.
 */

/** A thread as a surface names it. */
export interface ThreadRef {
  threadId: string;
  title: string;
}

/** "Keep caches warm while waiting": every waiting thread, only threads switched on, or never. */
export type KeepWarmSetting = "every" | "switched" | "never";

/** Whether a tree whose top recorded `recorded` (null when nobody flipped it) is kept warm under `setting`. */
export function keptWarm(setting: KeepWarmSetting, recorded: boolean | null): boolean {
  if (setting === "never") return false;
  return recorded ?? setting === "every";
}

/**
 * The tree top above `id`, or `id` itself: the highest Claude Code thread
 * among it and its ancestors. Null when none of them is a Claude Code thread.
 */
export function treeTopOf(id: string, parentOf: (id: string) => string | null | undefined, isClaude: (id: string) => boolean): string | null {
  let top: string | null = null;
  const seen = new Set<string>();
  for (let at: string | null | undefined = id; at != null && !seen.has(at); at = parentOf(at)) {
    seen.add(at);
    if (isClaude(at)) top = at;
  }
  return top;
}

/** The tree tops below `id`, nearest first: each Claude Code thread under it with no Claude Code thread between them. */
export function treeTopsBelow(id: string, childrenOf: (id: string) => readonly string[], isClaude: (id: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let level = [...childrenOf(id)];
  while (level.length > 0) {
    const next: string[] = [];
    for (const c of level) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (isClaude(c)) out.push(c);
      else next.push(...childrenOf(c));
    }
    level = next;
  }
  return out;
}
