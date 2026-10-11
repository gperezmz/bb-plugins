// Auto-settle: the server pass that settles quiet threads and merged or closed
// pull requests. This module is the seam the server calls; `createAutoSettle`
// is where the pass is built.
import type { SettingKey } from "../shared/settings";
import { notImplemented } from "./not-implemented";

export interface AutoSettleResult {
  /** Threads the pass settled. */
  settled: string[];
  /** Threads it returned from an automatic settle. */
  unsettled: string[];
}

export interface AutoSettle {
  /** Runs a pass now, behind the one running; resolves with what that pass did. */
  run(): Promise<AutoSettleResult>;
  /** Called after the settings changed; a change to an auto-settle setting starts a pass. */
  onSettingsChanged(keys: readonly SettingKey[]): void;
}

/** Auto-settle until the pass is built: running it throws, a settings change does nothing. */
export function createAutoSettle(): AutoSettle {
  return {
    run: notImplemented("runAutoSettle", "auto-settle"),
    onSettingsChanged: () => undefined,
  };
}
