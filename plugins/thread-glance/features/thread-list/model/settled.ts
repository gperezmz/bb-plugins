// Settled threads: which trees go behind their group's settled fold.
// Worked out afresh on every build, so any activity unsettles a thread. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SettleAfter } from "@/shared/preferences";
import { isQuietThread } from "./state";
import type { ThreadInfo, ThreadTree } from "./trees";

const HOUR = 60 * 60 * 1000;

/** How long a thread goes without activity before it settles, per Settle after choice. */
export const SETTLE_AFTER_MS: Readonly<Record<Exclude<SettleAfter, "never">, number>> = {
  "12h": 12 * HOUR,
  "1d": 24 * HOUR,
  "3d": 3 * 24 * HOUR,
  "1w": 7 * 24 * HOUR,
};

export interface SettleInputs {
  now: number;
  settleAfter: SettleAfter;
  /** Server stamps: when each thread last started and finished a turn. */
  startedAt: Readonly<Record<string, number>>;
  finishedAt: Readonly<Record<string, number>>;
}

/**
 * A thread's own last activity: its creation, its last finish or failure
 * (`latestAttentionAt`) and the server's stamps of its last start and
 * finish. `updatedAt` is left out because opening or renaming a thread
 * moves it too.
 */
export function lastActivityAt(
  thread: Pick<PluginSidebarThread, "id" | "createdAt" | "latestAttentionAt">,
  stamps: Pick<SettleInputs, "startedAt" | "finishedAt">,
): number {
  return Math.max(
    thread.createdAt,
    thread.latestAttentionAt,
    stamps.startedAt[thread.id] ?? 0,
    stamps.finishedAt[thread.id] ?? 0,
  );
}

/**
 * A settled thread: quiet as if no thread were focused, not needing attention,
 * not pinned, and its own last activity is older than the Settle after
 * period. Focus plays no part, so opening a settled thread leaves it settled.
 * Hidden and archived threads take the same test.
 */
export function isSettledThread(info: ThreadInfo, inputs: SettleInputs): boolean {
  const thread = info.thread;
  if (thread.pinnedAt !== null || thread.isPinned) return false;
  if (!isQuietThread(info.state, info.unread, false) || info.attentionFlags.size > 0) return false;
  if (inputs.settleAfter === "never") return false;
  return inputs.now - lastActivityAt(thread, inputs) >= SETTLE_AFTER_MS[inputs.settleAfter];
}

/** A tree settles as one unit: when every thread in it is settled. */
export function isSettledTree(tree: Pick<ThreadTree, "root" | "descendants">, inputs: SettleInputs): boolean {
  return isSettledThread(tree.root, inputs) && tree.descendants.every((info) => isSettledThread(info, inputs));
}

/**
 * Which settled trees stay out of their group's settled fold for now, by
 * root id, and which trees were settled, as of the last build.
 */
export interface SettleHold {
  settled: ReadonlySet<string>;
  held: ReadonlySet<string>;
}

/**
 * The hold after this build. A tree that becomes settled while it holds the
 * focused thread (read on opening, or its Settle after period running out)
 * stays where it is, out of the fold, until no thread in its group's settled
 * trees is focused; then it goes into the fold. So opening a thread never
 * moves the row you opened. `previous` is null on the first build, when
 * nothing is held.
 */
export function holdSettled(
  previous: SettleHold | null,
  trees: readonly Pick<ThreadTree, "root" | "descendants" | "containsActive">[],
  inputs: SettleInputs,
  groupOf: (root: ThreadInfo) => string,
): SettleHold {
  const settledTrees = trees.filter((tree) => isSettledTree(tree, inputs));
  const settled = new Set(settledTrees.map((tree) => tree.root.thread.id));
  const focused = settledTrees.find((tree) => tree.containsActive);
  const focusedGroup = focused === undefined ? null : groupOf(focused.root);
  const held = new Set<string>();
  for (const tree of settledTrees) {
    const id = tree.root.thread.id;
    const stillHeld = previous?.held.has(id) === true && groupOf(tree.root) === focusedGroup;
    const newlyHeld = tree.containsActive && previous !== null && !previous.settled.has(id);
    if (stillHeld || newlyHeld) held.add(id);
  }
  return { settled, held };
}
