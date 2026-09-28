/**
 * When a thread tree's keep-warms are sent, and to which threads.
 *
 * bb reports every child turn to its parent, and the report's turn refreshes
 * the parent's cache, so a keep-warm sent to a waiting thread at the bottom
 * of a tree keeps every waiting thread above it warm too. Cache Keeper sends
 * keep-warms only to those leaves, together. A leaf goes at its own deadline,
 * or earlier where a waiting thread above it would reach its deadline first:
 * that thread's deadline less 60 seconds and 30 for each level between them,
 * so the report climbs to it in time. Once a tree is aligned, the threads
 * above are refreshed by the reports and their deadlines trail the leaves',
 * so a tree cycles about once per cache lifetime, less the minute's margin.
 * A thread whose cache nothing refreshed by its own deadline still gets its
 * own keep-warm then, a little later while a report is climbing to it.
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
/** An own-deadline keep-warm waits this long for a report already on its way; the cache is still warm for 60. */
const REPORT_GRACE_MS = 30_000;

/** The lead for a send whose deepest leaf is `depth` levels below the top-level thread. */
export const leadMs = (depth: number) => LEAD_MS + LEAD_PER_LEVEL_MS * depth;

export function planTree(nodes: readonly TreeNode[], now: number): TreePlan {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.parentId === null || !byId.has(n.parentId)) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  }
  // Its parent, grandparent and so on up to the top-level thread; a loop ends it.
  const ancestors = (n: TreeNode): TreeNode[] => {
    const out: TreeNode[] = [];
    for (let at = n.parentId === null ? undefined : byId.get(n.parentId); at !== undefined && out.length < nodes.length; at = at.parentId === null ? undefined : byId.get(at.parentId)) {
      out.push(at);
    }
    return out;
  };
  const depth = (n: TreeNode) => ancestors(n).length;
  const blocked = (n: TreeNode) => n.blocks || ancestors(n).some((a) => a.blocks);
  const candidate = (n: TreeNode) =>
    n.keepable && !n.selfOff && !blocked(n) && n.deadline !== null && n.lifetimeMs !== null && now < n.deadline + ACT_WINDOW_MS;
  const candidates = nodes.filter(candidate);
  const isCandidate = new Set(candidates.map((n) => n.id));
  const hasCandidateBelow = (n: TreeNode): boolean => (children.get(n.id) ?? []).some((c) => isCandidate.has(c.id) || hasCandidateBelow(c));

  const planned = new Set<string>();
  for (const n of candidates) for (const at of [n, ...ancestors(n)]) planned.add(at.id);

  const due: TreePlan["due"] = [];
  const nextAt = new Map<string, number>();
  if (candidates.length === 0) return { planned, due, nextAt, wakeAt: null };

  const leaves = candidates.filter((n) => !hasCandidateBelow(n));
  // When each leaf must go: its own deadline, or earlier for a waiting thread above whose deadline comes first.
  const dueOf = (leaf: TreeNode) => {
    let at = leaf.deadline!;
    for (const a of ancestors(leaf)) {
      if (isCandidate.has(a.id) && a.deadline! < leaf.deadline!) at = Math.min(at, a.deadline! - leadMs(depth(leaf) - depth(a)));
    }
    return at;
  };
  const dues = new Map(leaves.map((n) => [n.id, dueOf(n)]));
  const sendAt = Math.min(...dues.values());
  // The leaves that could not wait for the tree's next send, once this one has refreshed it, go with this one.
  const next = sendAt + Math.min(...leaves.map((n) => n.lifetimeMs!)) - CACHE_MARGIN_MS;
  const send = leaves.filter((n) => dues.get(n.id)! < next);
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
  // A thread with a send or report on its way below it, or a leaf being sent now, waits a little past its deadline for the report.
  const climbing = (n: TreeNode) => n.reportPending || nodes.some((d) => (d.inFlight || d.reportPending || sending.has(d.id)) && ancestors(d).includes(n));
  const ownAt = (n: TreeNode) => (climbing(n) ? n.deadline! + REPORT_GRACE_MS : n.deadline!);
  for (const n of candidates) {
    if (sending.has(n.id) || n.inFlight) continue;
    if (now >= ownAt(n)) due.push({ id: n.id, tree: false });
  }

  const wakes: number[] = [];
  for (const n of candidates) {
    const own = ownAt(n);
    const at = send.includes(n) && !holding ? Math.min(sendAt, own) : own;
    nextAt.set(n.id, send.includes(n) ? Math.min(sendAt, own) : own);
    if (!n.inFlight) wakes.push(at);
  }
  for (const n of nodes) if (!nextAt.has(n.id) && planned.has(n.id)) nextAt.set(n.id, Math.min(...candidates.filter((c) => ancestors(c).includes(n)).map((c) => nextAt.get(c.id)!)));
  const future = wakes.filter((w) => w > now);
  return { planned, due, nextAt, wakeAt: future.length === 0 ? null : Math.min(...future) };
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
