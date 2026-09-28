/**
 * What Cache Keeper knows of bb's threads, kept in memory and brought up to
 * date by bb's plugin events, with one paged `threads.list` at startup and at
 * each reconciliation check. Trees are read from the parent and child maps, so
 * nothing here walks every thread bb knows.
 *
 * bb's replies are checked as they arrive: a thread whose reply lacks a field
 * the plugin acts on is marked with it, so nothing is sent to it until a later
 * reply carries the field.
 */

/** A thread as the plugin acts on it. */
export interface Known {
  id: string;
  parentId: string | null;
  providerId: string;
  status: string;
  archived: boolean;
  deleted: boolean;
  title: string;
  createdAt: number;
  /** bb's `updatedAt`, on bb's clock: the restart watermark is read against it. */
  updatedAt: number;
  /** The machine running it; undefined until a reply names it. */
  hostId: string | null | undefined;
  /** Whether it waits on your answer. Null until a reply carries it, which counts as waiting on you. */
  pending: boolean | null;
  /** bb's own counts, which run ahead of the task events Cache Keeper reads at a turn's end. */
  commands: number;
  agents: number;
  queuedWork: "none" | "waiting" | "failed";
  lastReadAt: number | null;
  latestAttentionAt: number | null;
  /** Fields a reply the plugin acts on lacked, since the last reply that carried them. */
  missing: string[];
}

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const has = (r: Json, key: string) => Object.prototype.hasOwnProperty.call(r, key);

/** The fields every thread reply must carry for the plugin to act on the thread. */
const REQUIRED = ["id", "providerId", "status", "parentThreadId", "archivedAt", "deletedAt"] as const;

/**
 * Reads one thread from a reply of bb's: a `threads.list` row (`listed`),
 * which also carries the pending interaction, the machine and the background
 * counts, or an event's thread, which does not. Returns the fields read and
 * those missing.
 */
export function readThread(raw: unknown, listed: boolean): { patch: Partial<Known> & { id: string }; missing: string[] } | null {
  const r = rec(raw);
  if (typeof r.id !== "string") return null;
  const missing: string[] = REQUIRED.filter((k) => !has(r, k));
  if (listed && typeof r.hasPendingInteraction !== "boolean") missing.push("hasPendingInteraction");
  const patch: Partial<Known> & { id: string } = { id: r.id };
  if (typeof r.providerId === "string") patch.providerId = r.providerId;
  if (typeof r.status === "string") patch.status = r.status;
  if (has(r, "parentThreadId")) patch.parentId = typeof r.parentThreadId === "string" ? r.parentThreadId : null;
  if (has(r, "archivedAt")) patch.archived = r.archivedAt !== null;
  if (has(r, "deletedAt")) patch.deleted = r.deletedAt !== null;
  if (typeof r.title === "string" || typeof r.titleFallback === "string") patch.title = (r.title as string | null) ?? (r.titleFallback as string);
  if (typeof r.createdAt === "number") patch.createdAt = r.createdAt;
  if (typeof r.updatedAt === "number") patch.updatedAt = r.updatedAt;
  if (typeof r.lastReadAt === "number" || r.lastReadAt === null) patch.lastReadAt = r.lastReadAt as number | null;
  if (typeof r.latestAttentionAt === "number") patch.latestAttentionAt = r.latestAttentionAt;
  if (listed) {
    patch.pending = typeof r.hasPendingInteraction === "boolean" ? r.hasPendingInteraction : null;
    if (has(r, "environmentHostId")) patch.hostId = typeof r.environmentHostId === "string" ? r.environmentHostId : null;
    const activity = rec(r.activity);
    if (typeof activity.activeBackgroundCommandCount === "number") patch.commands = activity.activeBackgroundCommandCount;
    if (typeof activity.activeBackgroundAgentCount === "number") patch.agents = activity.activeBackgroundAgentCount;
    if (r.queuedWork === "none" || r.queuedWork === "waiting" || r.queuedWork === "failed") patch.queuedWork = r.queuedWork;
  } else {
    if (typeof r.activeBackgroundAgentCount === "number") patch.agents = r.activeBackgroundAgentCount;
    if (typeof r.queuedMessageCount === "number") patch.queuedWork = r.queuedMessageCount > 0 ? "waiting" : "none";
  }
  return { patch, missing };
}

const blank = (id: string): Known => ({
  id,
  parentId: null,
  providerId: "",
  status: "idle",
  archived: false,
  deleted: false,
  title: id,
  createdAt: 0,
  updatedAt: 0,
  hostId: undefined,
  pending: null,
  commands: 0,
  agents: 0,
  queuedWork: "none",
  lastReadAt: null,
  latestAttentionAt: null,
  missing: [],
});

export class ThreadIndex {
  private readonly threads = new Map<string, Known>();
  private readonly children = new Map<string, Set<string>>();

  get(id: string): Known | undefined {
    return this.threads.get(id);
  }

  size(): number {
    return this.threads.size;
  }

  ids(): IterableIterator<string> {
    return this.threads.keys();
  }

  /** Applies what a reply said of a thread. Returns the thread as it now stands. */
  apply(patch: Partial<Known> & { id: string }, missing: string[] = []): Known {
    const before = this.threads.get(patch.id);
    const next: Known = { ...(before ?? blank(patch.id)), ...patch, missing };
    if (before !== undefined && before.parentId !== next.parentId && before.parentId !== null) this.children.get(before.parentId)?.delete(next.id);
    if (next.parentId !== null) {
      let set = this.children.get(next.parentId);
      if (set === undefined) this.children.set(next.parentId, (set = new Set()));
      set.add(next.id);
    }
    this.threads.set(next.id, next);
    return next;
  }

  /** Forgets a thread bb deleted. */
  remove(id: string): void {
    const t = this.threads.get(id);
    if (t === undefined) return;
    if (t.parentId !== null) this.children.get(t.parentId)?.delete(id);
    this.threads.delete(id);
  }

  isLive(id: string): boolean {
    const t = this.threads.get(id);
    return t !== undefined && !t.archived && !t.deleted;
  }

  isClaude(id: string): boolean {
    return this.threads.get(id)?.providerId === "claude-code";
  }

  /** Its parent while the parent is live: an archived or deleted thread ends its tree. */
  liveParentOf(id: string): string | null {
    const parent = this.threads.get(id)?.parentId ?? null;
    return parent !== null && this.isLive(parent) ? parent : null;
  }

  /** Its live children. */
  childrenOf(id: string): string[] {
    return [...(this.children.get(id) ?? [])].filter((c) => this.isLive(c));
  }

  /** The top of its live tree: follow live parents to one with none. */
  topOf(id: string): string {
    let at = id;
    const seen = new Set([id]);
    for (let p = this.liveParentOf(at); p !== null && !seen.has(p); p = this.liveParentOf(at)) {
      seen.add(p);
      at = p;
    }
    return at;
  }

  /** The top-level thread above it by bb's parent links, archived or not: whose thread tree it is in. */
  rootOf(id: string): string {
    let at = id;
    const seen = new Set([id]);
    for (let p = this.threads.get(at)?.parentId ?? null; p !== null && this.threads.has(p) && !seen.has(p); p = this.threads.get(at)?.parentId ?? null) {
      seen.add(p);
      at = p;
    }
    return at;
  }

  /** The live tree under `top`, `top` first, parents before children. */
  treeOf(top: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue = [top];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id) || !this.isLive(id)) continue;
      seen.add(id);
      out.push(id);
      queue.push(...(this.children.get(id) ?? []));
    }
    return out;
  }

  /** Levels between it and the top of its live tree. */
  depthOf(id: string): number {
    let depth = 0;
    const seen = new Set([id]);
    for (let p = this.liveParentOf(id); p !== null && !seen.has(p); p = this.liveParentOf(p)) {
      seen.add(p);
      depth++;
    }
    return depth;
  }
}
