/**
 * What a first load after uninstalling and installing again does. bb clears
 * a plugin's settings on uninstall but keeps its `data.db`, so stored switches
 * would otherwise turn spending back on unasked. bb runs `onInstall` on every
 * install, a first one included; stored rows tell a reinstall apart.
 */
import type { AgentTools } from "./agent-tools";
import type { Store } from "./store";

export const RESET_META = "reinstallReset";

/** Shown first in `status` until a switch is next flipped. */
export interface ResetNotice {
  at: number;
  threads: number;
}

export async function resetAfterReinstall(deps: {
  store: Store;
  engine: { flush(): void; resetSwitches(): number };
  agentTools: AgentTools;
  now: number;
  setCheckIns(on: boolean): Promise<unknown>;
}): Promise<ResetNotice | null> {
  deps.engine.flush();
  if (deps.store.isEmpty()) return null;
  const threads = deps.engine.resetSwitches();
  deps.agentTools.allOff();
  await deps.setCheckIns(false).catch(() => {});
  const notice: ResetNotice = { at: deps.now, threads };
  deps.store.setMeta(RESET_META, notice);
  return notice;
}
