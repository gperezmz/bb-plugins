// The rule for a waiting settle: a Settle chosen for a thread tree while a
// thread in it was busy. Pure: the server reads bb's threads and the turns
// they ran since the settle was chosen, and asks this what becomes of it.
import { isBusy, type BusyInput } from "./busy";

/** What the rule reads from a thread of the tree. */
export interface WaitingTreeThread extends BusyInput {
  id: string;
  isPinned: boolean;
  /** Hidden threads are bb's helpers: their questions are no one's to answer, so only their work holds the settle. */
  hidden: boolean;
}

/**
 * A turn event of a thread in the tree, as bb recorded it: a turn asked for,
 * by the user (no sender thread, a user's message) or not, or a turn that
 * ended, and how.
 */
export type TurnRecord =
  | { kind: "requested"; at: number; byUser: boolean }
  | { kind: "ended"; at: number; outcome: "completed" | "failed" | "interrupted" };

/** Why a waiting settle ends without settling. */
export type WaitingSettleEnd = "pinned" | "needs-you" | "yours" | "failed";

/** What becomes of a waiting settle: it keeps waiting, it settles the tree, or it ends. */
export type WaitingSettleVerdict = { kind: "wait" } | { kind: "land" } | { kind: "end"; reason: WaitingSettleEnd };

const WAIT: WaitingSettleVerdict = { kind: "wait" };
const LAND: WaitingSettleVerdict = { kind: "land" };

/**
 * Why the turns since `since` end the settle, or null: a turn the user asked
 * for (a message they sent, a child they started) or a turn that failed or
 * was interrupted. An agent's messages and spawns, and bb's own turns such
 * as a parent notification, leave it waiting.
 */
export function endingTurn(turns: readonly TurnRecord[], since: number): WaitingSettleEnd | null {
  for (const turn of turns) {
    if (turn.at <= since) continue;
    if (turn.kind === "requested" && turn.byUser) return "yours";
    if (turn.kind === "ended" && turn.outcome !== "completed") return "failed";
  }
  return null;
}

/**
 * What becomes of a settle waiting since `since` on `tree`, the thread it was
 * chosen for and every thread below it: a pin or a question or approval on a
 * visible thread ends it; so do `turns`, as `endingTurn` reads them; a busy
 * thread keeps it waiting; otherwise it lands. `turns` may be left out while a
 * thread is busy, since a waiting settle reads them before it lands.
 */
export function waitingSettleVerdict(
  tree: readonly WaitingTreeThread[],
  since: number,
  turns: readonly TurnRecord[] = [],
): WaitingSettleVerdict {
  if (tree.some((thread) => thread.isPinned)) return { kind: "end", reason: "pinned" };
  if (tree.some((thread) => !thread.hidden && thread.hasPendingInteraction)) return { kind: "end", reason: "needs-you" };
  const ended = endingTurn(turns, since);
  if (ended !== null) return { kind: "end", reason: ended };
  return tree.some((thread) => isBusy(thread)) ? WAIT : LAND;
}
