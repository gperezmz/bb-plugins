/**
 * Thread trees over the plugin's own edge table. A thread tree is a
 * thread plus every descendant by `parentThreadId`. Forks (threads with a
 * `sourceThreadId`, side chats included) are not tree members, and their
 * subtrees are not either.
 */

export interface Edge {
  threadId: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  providerId: string | null;
  projectId: string | null;
  title: string | null;
  hidden: boolean;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number | null;
}

export interface EdgeIndex {
  byId: Map<string, Edge>;
  children: Map<string, Edge[]>;
  forks: Map<string, Edge[]>;
}

export function isFork(edge: Edge): boolean {
  return edge.sourceThreadId !== null;
}

export function indexEdges(edges: Iterable<Edge>): EdgeIndex {
  const byId = new Map<string, Edge>();
  const children = new Map<string, Edge[]>();
  const forks = new Map<string, Edge[]>();
  for (const edge of edges) byId.set(edge.threadId, edge);
  const push = (map: Map<string, Edge[]>, key: string, edge: Edge) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [edge]);
    else list.push(edge);
  };
  for (const edge of byId.values()) {
    if (isFork(edge)) {
      push(forks, edge.sourceThreadId as string, edge);
    } else if (edge.parentThreadId !== null && edge.parentThreadId !== edge.threadId) {
      push(children, edge.parentThreadId, edge);
    }
  }
  const order = (a: Edge, b: Edge) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.threadId.localeCompare(b.threadId);
  for (const list of children.values()) list.sort(order);
  for (const list of forks.values()) list.sort(order);
  return { byId, children, forks };
}

export interface TreeNode {
  edge: Edge;
  depth: number;
  children: TreeNode[];
}

/** The tree under `rootId` (the root included). Cycles are cut. */
export function treeOf(index: EdgeIndex, rootId: string): TreeNode {
  const seen = new Set<string>();
  const build = (edge: Edge, depth: number): TreeNode => {
    seen.add(edge.threadId);
    const kids = (index.children.get(edge.threadId) ?? []).filter((c) => !seen.has(c.threadId));
    return { edge, depth, children: kids.map((c) => build(c, depth + 1)) };
  };
  const root = index.byId.get(rootId) ?? unknownEdge(rootId);
  return build(root, 0);
}

/** Every thread id in the tree, root first, depth-first. */
export function treeIds(index: EdgeIndex, rootId: string): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    out.push(node.edge.threadId);
    node.children.forEach(walk);
  };
  walk(treeOf(index, rootId));
  return out;
}

/** Ancestors by `parentThreadId`, nearest first. Stops at forks' sources: a fork's tree ends at the fork. */
export function ancestorIds(index: EdgeIndex, threadId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([threadId]);
  let edge = index.byId.get(threadId);
  while (edge !== undefined && !isFork(edge) && edge.parentThreadId !== null) {
    if (seen.has(edge.parentThreadId)) break;
    seen.add(edge.parentThreadId);
    out.push(edge.parentThreadId);
    edge = index.byId.get(edge.parentThreadId);
  }
  return out;
}

/** The top of `threadId`'s tree: its furthest ancestor. */
export function rootOf(index: EdgeIndex, threadId: string): string {
  const ancestors = ancestorIds(index, threadId);
  return ancestors[ancestors.length - 1] ?? threadId;
}

export function forksOf(index: EdgeIndex, threadId: string): Edge[] {
  return index.forks.get(threadId) ?? [];
}

export function unknownEdge(threadId: string): Edge {
  return {
    threadId,
    parentThreadId: null,
    sourceThreadId: null,
    providerId: null,
    projectId: null,
    title: null,
    hidden: false,
    archivedAt: null,
    deletedAt: null,
    createdAt: null,
  };
}
