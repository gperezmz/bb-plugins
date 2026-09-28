/**
 * Settings → Plugins → Cache Keeper → Agent tools: one switch per agent tool
 * Cache Keeper registers, all off on a fresh install. bb offers a tool to a
 * thread only while its switch is on, from the thread's next session start
 * or resume.
 */
import { useState } from "react";
import type { AgentToolRow } from "@/src/server/agent-tools";
import { useKeeperRpc, useLive } from "../api";

export const AGENT_TOOLS_TITLE = "Agent tools";
export const AGENT_TOOLS_DESCRIPTION = "Tools Claude Code agents may use on their own thread. A change reaches a thread when its session next starts or resumes.";

export function AgentTools() {
  const rpc = useKeeperRpc();
  const live = useLive(() => rpc.call("agentTools", null), [rpc]);
  const [error, setError] = useState<string | null>(null);
  const flip = (row: AgentToolRow) =>
    rpc.call("setAgentTool", { name: row.key, on: !row.on }).then(
      (rows) => {
        setError(null);
        live.setData(rows);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  if (live.error !== null) return <p className="text-sm text-destructive">{live.error}</p>;
  if (live.data === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {live.data.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3">
          <span id={`agent-tool-${row.key}`}>
            {row.label} <code className="text-xs text-muted-foreground">{row.name}</code>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={row.on}
            aria-labelledby={`agent-tool-${row.key}`}
            onClick={() => void flip(row)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${row.on ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute left-0 top-0.5 size-4 rounded-full bg-background shadow transition-transform ${row.on ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>
      ))}
      {error !== null && <p className="text-destructive">{error}</p>}
    </div>
  );
}
