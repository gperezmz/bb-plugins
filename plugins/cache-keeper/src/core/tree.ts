/**
 * When a thread tree's keep-warms are sent, and to which threads.
 *
 * bb reports every child turn to its parent, and the report's turn refreshes
 * the parent's cache, so a keep-warm sent to a waiting thread at the bottom
 * of a tree keeps every waiting thread above it warm too. Cache Keeper sends
 * keep-warms only to those leaves, all at once, early enough before the
 * earliest deadline in the tree for the reports to climb: 60 seconds plus 30
 * for each level down to the deepest leaf in the send. A thread whose cache
 * nothing refreshed by its own deadline still gets its own keep-warm then.
 */
import { CACHE_MARGIN_MS } from "./transcript";

/** One thread of a tree, as the planner reads it. */
export interface TreeNode {
  id: string;
  /** Its parent in the tree; null for the top-level thread. */
  parentId: string | null;
  /** An idle Claude Code thread, waiting, with no pending interaction and a known deadline, that keep-warms are switched on for. */
  keepable: boolean;
  deadline: number | null;
  lifetimeMs: number | null;
  /** Skipped for this wait, or past its cost stop: nothing is sent to it or to any thread below it. */
  blocks: boolean;
  /** Past its own cost stop in a way that leaves the threads below alone (a scheduled message due after the stop). */
  selfOff: boolean;
  /** A message Cache Keeper sent it has not finished its turn. */
  inFlight: boolean;
  /** A report of a child's turn is on its way into it. */
  reportPending: boolean;
}

export interface TreePlan {
  /** Threads with a keep-warm planned for themselves or for a thread below them. */
  planned: Set<string>;
  /** Keep-warms due now; `tree` marks the ones sent together to the tree's leaves. */
  due: { id: string; tree: boolean }[];
  /** When each planned thread is next sent a keep-warm. */
  nextAt: Map<string, number>;
  /** The earliest moment anything in the tree falls due, for the timer. */
  wakeAt: number | null;
}

export const LEAD_MS = 60_000;
export const LEAD_PER_LEVEL_MS = 30_000;
/** How long after its deadline a thread's cache is still warm: the margin the deadline leaves. */
const ACT_WINDOW_MS = CACHE_MARGIN_MS;
/** An own-deadline keep-warm waits this long for a report already on its way. */
const REPORT_GRACE_MS = 20_000;

/** The lead for a send whose deepest leaf is `depth` levels below the top-level thread. */
export const leadMs = (depth: number) => LEAD_MS + LEAD_PER_LEVEL_MS * depth;

export function planTree(nodes: readonly TreeNode[], now: number): TreePlan {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.parentId === null || !byId.has(n.parentId)) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  }
  const depth = (n: TreeNode): number => {
    let d = 0;
    for (let p = n.parentId; p !== null && byId.has(p) && d < nodes.length; p = byId.get(p)!.parentId) d++;
    return d;
  };
  const blocked = (n: TreeNode): boolean => {
    for (let at: TreeNode | undefined = n, d = 0; at !== undefined && d <= nodes.length; at = at.parentId === null ? undefined : byId.get(at.parentId), d++) {
      if (at.blocks) return true;
    }
    return false;
  };
  const candidate = (n: TreeNode) =>
    n.keepable && !n.selfOff && !blocked(n) && n.deadline !== null && n.lifetimeMs !== null && now < n.deadline + ACT_WINDOW_MS;
  const candidates = nodes.filter(candidate);
  const isCandidate = new Set(candidates.map((n) => n.id));
  const hasCandidateBelow = (n: TreeNode): boolean => (children.get(n.id) ?? []).some((c) => isCandidate.has(c.id) || hasCandidateBelow(c));

  const planned = new Set<string>();
  for (const n of candidates) for (let at: TreeNode | undefined = n; at !== undefined && !planned.has(at.id); at = at.parentId === null ? undefined : byId.get(at.parentId)) planned.add(at.id);

  const due: TreePlan["due"] = [];
  const nextAt = new Map<string, number>();
  if (candidates.length === 0) return { planned, due, nextAt, wakeAt: null };

  const leaves = candidates.filter((n) => !hasCandidateBelow(n));
  const earliest = Math.min(...candidates.map((n) => n.deadline!));
  const shortest = Math.min(...candidates.map((n) => n.lifetimeMs!));
  // The leaves too close to their deadline to wait for the tree's next send; the rest go with that one.
  const sendAtFor = (lead: number) => earliest - lead;
  const inSend = (lead: number) => {
    const next = sendAtFor(lead) + shortest - CACHE_MARGIN_MS - lead;
    return leaves.filter((n) => n.deadline! - lead < next);
  };
  const deepest = (list: readonly TreeNode[]) => Math.max(0, ...list.map(depth));
  const lead = leadMs(deepest(inSend(leadMs(deepest(leaves)))));
  const send = inSend(lead);
  const sendAt = sendAtFor(lead);
  // A send, or a report, still on its way is part of the last cycle.
  const holding = nodes.some((n) => n.inFlight || n.reportPending);

  const sending = new Set<string>();
  if (!holding && now >= sendAt) {
    for (const n of send) {
      if (n.inFlight) continue;
      due.push({ id: n.id, tree: true });
      sending.add(n.id);
    }
  }
  for (const n of candidates) {
    if (sending.has(n.id) || n.inFlight) continue;
    const late = n.reportPending ? n.deadline! + REPORT_GRACE_MS : n.deadline!;
    if (now >= late) due.push({ id: n.id, tree: false });
  }

  const wakes: number[] = [];
  for (const n of candidates) {
    const own = n.reportPending ? n.deadline! + REPORT_GRACE_MS : n.deadline!;
    const next = send.includes(n) ? Math.min(sendAt, own) : own;
    nextAt.set(n.id, next);
    if (!n.inFlight) wakes.push(n.reportPending ? own : next);
  }
  for (const n of nodes) if (!nextAt.has(n.id) && planned.has(n.id)) nextAt.set(n.id, Math.min(...candidates.filter((c) => isBelow(c, n, byId)).map((c) => nextAt.get(c.id)!)));
  const future = wakes.filter((w) => w > now);
  return { planned, due, nextAt, wakeAt: future.length === 0 ? null : Math.min(...future) };
}

function isBelow(n: TreeNode, above: TreeNode, byId: Map<string, TreeNode>): boolean {
  for (let p = n.parentId, d = 0; p !== null && d <= byId.size; p = byId.get(p)?.parentId ?? null, d++) if (p === above.id) return true;
  return false;
}

/** The top-level thread of each thread: follow parents to one with none, or none listed. */
export function topOf(id: string, parentOf: (id: string) => string | null | undefined): string {
  let at = id;
  const seen = new Set<string>([id]);
  for (let p = parentOf(at); p != null && !seen.has(p); p = parentOf(at)) {
    seen.add(p);
    at = p;
  }
  return at;
}
