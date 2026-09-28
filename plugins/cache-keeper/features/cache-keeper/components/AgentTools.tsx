/**
 * Settings → Plugins → Cache Keeper → Agent tools: one switch per agent tool
 * Cache Keeper registers, all off on a fresh install. bb offers a tool to a
 * thread only while its switch is on, from the thread's next session start
 * or resume.
 */
import { useState } from "react";
import type { AgentToolRow } from "@/src/server/agent-tools";
import { useKeeperRpc, useLive } from "../api";
import { Switch } from "./Switch";

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
          <Switch checked={row.on} labelledBy={`agent-tool-${row.key}`} onClick={() => void flip(row)} />
        </div>
      ))}
      {error !== null && <p className="text-destructive">{error}</p>}
    </div>
  );
}
