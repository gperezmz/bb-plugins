// The options of the Parent… dialog: None first, then the threads the chosen
// thread may sit under. Pure.
import { lastActivityAt } from "@/shared/lifecycle";
import { descendantIds } from "@/shared/thread-tree";

/** What the options read from a thread. */
export interface ParentThread {
  id: string;
  displayTitle: string;
  projectId: string;
  parentThreadId: string | null;
  isArchived: boolean;
  isHidden: boolean;
  createdAt: number;
  updatedAt: number;
  latestAttentionAt: number;
}

export interface ParentOption {
  /** The thread to make the parent, or null for None. */
  id: string | null;
  /** What the option reads as, for matching a query. */
  label: string;
  /** What the option says before the thread's title: the project's name for a thread of another project, else nothing. */
  prefix: string;
  /** Whether it is the thread's current parent (None, for a thread without one). */
  checked: boolean;
}

export const NO_PARENT_LABEL = "None";

export interface ParentOptionsInput {
  thread: ParentThread;
  /** The threads bb lists: every non-archived thread, hidden ones included. */
  threads: readonly ParentThread[];
  /** The current parent when it is archived and so not among `threads`. */
  currentParent: ParentThread | null;
  projectNames: ReadonlyMap<string, string>;
  query: string;
}

/**
 * None, then every non-archived thread, hidden ones included, except the
 * thread itself and its descendants, and the current parent even when it is archived. Threads
 * of the thread's own project come first, then the others, each by recent
 * activity; another project's thread reads "Project · Title". `query` keeps
 * the options whose label contains it; None always stays.
 */
export function parentOptions({ thread, threads, currentParent, projectNames, query }: ParentOptionsInput): ParentOption[] {
  const excluded = new Set([thread.id, ...descendantIds(threads, thread.id)]);
  const candidates = new Map<string, ParentThread>();
  for (const candidate of threads) {
    if (excluded.has(candidate.id)) continue;
    if (candidate.id === thread.parentThreadId || !candidate.isArchived) candidates.set(candidate.id, candidate);
  }
  if (currentParent !== null && !excluded.has(currentParent.id) && currentParent.id === thread.parentThreadId) {
    candidates.set(currentParent.id, currentParent);
  }
  const prefixOf = (candidate: ParentThread): string =>
    candidate.projectId === thread.projectId ? "" : `${projectNames.get(candidate.projectId) ?? "Unknown project"} · `;
  const needle = query.trim().toLowerCase();
  const options = [...candidates.values()]
    .sort((a, b) => {
      const sameA = a.projectId === thread.projectId ? 0 : 1;
      const sameB = b.projectId === thread.projectId ? 0 : 1;
      return sameA - sameB || lastActivityAt(b) - lastActivityAt(a) || a.id.localeCompare(b.id);
    })
    .map((candidate): ParentOption => {
      const prefix = prefixOf(candidate);
      return { id: candidate.id, label: `${prefix}${candidate.displayTitle}`, prefix, checked: candidate.id === thread.parentThreadId };
    })
    .filter((option) => needle === "" || option.label.toLowerCase().includes(needle));
  return [{ id: null, label: NO_PARENT_LABEL, prefix: "", checked: thread.parentThreadId === null }, ...options];
}

/** Why a parent cannot be chosen: it sits below the thread. */
export const PARENT_BELOW_REFUSAL = "That thread sits below this one, so it can't be its parent.";

/** The longest chain of ancestors followed before giving up on a loop. */
const MAX_ANCESTORS = 1_000;

/**
 * Whether `candidateId` is `threadId` or sits below it, found by following
 * the candidate's parents up. `parentOf` answers a thread's parent, archived
 * threads included, which the list bb shows leaves out; null ends the chain.
 */
export async function sitsBelow(threadId: string, candidateId: string, parentOf: (id: string) => Promise<string | null>): Promise<boolean> {
  const seen = new Set<string>();
  for (let id: string | null = candidateId; id !== null && seen.size < MAX_ANCESTORS; id = await parentOf(id)) {
    if (id === threadId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return false;
}

/** What changing the parent does to the thread's pin: choosing a parent unpins a pinned thread, None keeps it. */
export function unpinsOnChoice(isPinned: boolean, parentId: string | null): boolean {
  return isPinned && parentId !== null;
}
