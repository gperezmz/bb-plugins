/**
 * What a first load after uninstalling and installing again does. bb keeps a
 * plugin's `data.db` on uninstall, so stored switches would otherwise turn
 * spending back on unasked. bb runs `onInstall` on every install, a first one
 * included, and on no update; stored rows tell a reinstall apart. The four
 * settings go back to their defaults on every install, as they did while bb
 * held them and cleared them on uninstall.
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
  resetSettings(): void;
}): Promise<ResetNotice | null> {
  deps.engine.flush();
  deps.resetSettings();
  if (deps.store.isEmpty()) return null;
  const threads = deps.engine.resetSwitches();
  deps.agentTools.allOff();
  const notice: ResetNotice = { at: deps.now, threads };
  deps.store.setMeta(RESET_META, notice);
  return notice;
}
