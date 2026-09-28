/**
 * What the frontend's RPC calls and the agent tool do, apart from bb's
 * registration of them, so a test drives them over a real engine.
 */
import { aboveSetting } from "../core/above";
import { formatSize, parseSize } from "../core/line";
import { rowStatus, type RowGlyph } from "../core/view";
import type { AgentTools } from "./agent-tools";
import { ClaudeOnlyError, DAY_MS, NoTreeTopError, NotReadyError, type Engine } from "./engine";
import type { Overview, RpcContract } from "./rpc";
import type { Store } from "./store";

export interface SurfaceDeps {
  engine: Engine;
  store: Store;
  agentTools: AgentTools;
  now(): number;
  /** A switch was flipped: the reinstall notice in `status` has done its job. */
  flipped(): void;
}

/** The engine's refusals as plain errors, which bb's RPC carries to the frontend with their message. */
const rpcError = (error: unknown): never => {
  if (error instanceof ClaudeOnlyError || error instanceof NotReadyError || error instanceof NoTreeTopError) throw new Error(error.message);
  throw error;
};

type Handlers = { [K in keyof RpcContract]: (input: never) => Promise<unknown> };

export function rpcHandlers({ engine, store, agentTools, now, flipped }: SurfaceDeps) {
  const switched = <T>(work: Promise<T>) => work.then((r) => (flipped(), r));
  const overview = async (): Promise<Overview> => {
    const recent = store.history(now() - 30 * DAY_MS, 50, ["compaction", "keep-warm", "check-in"]).map((h) => ({ ...h, title: engine.titleOf(h.threadId) }));
    const titles: Record<string, string> = {};
    for (const h of recent) for (const id of Object.keys(h.record.split ?? {})) titles[id] = engine.titleOf(id);
    return {
      switchedOn: engine.switchedOn(),
      waiting: engine.allViews().filter((v) => v.waiting && v.status === "idle"),
      recent,
      titles,
      totals: engine.totals(30),
    };
  };
  return {
    view: ({ threadId }: { threadId: string }) => engine.viewOf(threadId),
    setCompact: ({ threadId, on, setting }: { threadId: string; on: boolean; setting?: number }) => switched(engine.setCompact(threadId, on, setting)).catch(rpcError),
    setSetting: ({ threadId, setting }: { threadId: string; setting: number }) => switched(engine.setSetting(threadId, setting)).catch(rpcError),
    setKeepWarm: ({ threadId, on }: { threadId: string; on: boolean }) =>
      switched(engine.setKeepWarm(threadId, on))
        .then(() => engine.viewOf(threadId))
        .catch(rpcError),
    skip: ({ threadId, what, undo }: { threadId: string; what: "compaction" | "warm"; undo: boolean }) => switched(engine.skip(threadId, what, undo)),
    compactNow: ({ threadId }: { threadId: string }) => engine.compactNow(threadId).catch(rpcError),
    rowStatuses: async () =>
      engine
        .allViews()
        .map((v) => ({ threadId: v.threadId, status: rowStatus(v) }))
        .filter((r): r is RowGlyph => r.status !== null),
    overview,
    agentTools: async () => agentTools.rows(),
    setAgentTool: async ({ name, on }: { name: "compactWhenIdle"; on: boolean }) => {
      agentTools.set(name, on);
      flipped();
      return agentTools.rows();
    },
  } satisfies Handlers;
}

/**
 * The `cache_keeper_compact_when_idle` tool on the calling thread: refused
 * while its Agent tools switch is off, and for a size the thread's lines
 * cannot take. Answers JSON, with `error` when it changed nothing.
 */
export async function compactWhenIdle({ engine, agentTools, flipped }: SurfaceDeps, threadId: string, above: string | undefined): Promise<string> {
  try {
    if (!agentTools.isOn("compactWhenIdle")) {
      throw new Error("the Compact when idle agent tool is switched off in Settings → Plugins → Cache Keeper → Agent tools; nothing was changed");
    }
    let setting: number | undefined;
    if (above !== undefined) {
      const size = parseSize(above);
      if (size === null) throw new Error(`not a size: ${above}; give tokens, e.g. 500k or 0.5m. Nothing was changed.`);
      const view = await engine.viewOf(threadId);
      if (view === null) throw new ClaudeOnlyError("Cache Keeper acts on Claude Code threads only");
      setting = aboveSetting(size, view);
    }
    const view = await engine.setCompact(threadId, true, setting);
    flipped();
    return JSON.stringify({ on: true, line: formatSize(view?.line ?? null), setting: view?.setting ?? null, context: view?.context ?? null, windowKnown: view?.windowKnown ?? false });
  } catch (error) {
    return JSON.stringify({ on: false, error: error instanceof Error ? error.message : String(error) });
  }
}
