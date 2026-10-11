// The auto-settle hold-back, fed by the ports snapshot.
import type { ServerThread } from "../threads";
import type { PortsEngine } from "./engine";
import { holdBackThreads } from "./rules";

/**
 * The ids of the threads auto-settle leaves alone for a pass, from the
 * snapshot as it stands (a read up to 30 s old, or a new scan when it is
 * older).
 */
export function createHoldBack(engine: PortsEngine): (threads: readonly ServerThread[]) => Promise<ReadonlySet<string>> {
  return async (threads) => holdBackThreads(threads, await engine.read({ fresh: false }));
}
