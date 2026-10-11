// The request that keeps the workspace ports snapshot current: `ports`, asked
// for the whole window and never for a row. One call at a time, so a refresh
// that is due while another runs waits for it.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { portsSignalSchema } from "@/shared/ports";
import { pluginData } from "./plugin-data";

type Rpc = PluginRpcClient<RpcContract>;

/** How long after a refresh completes the next timed one is asked, while the page is visible. */
export const PORTS_REFRESH_MS = 10_000;

let running: Promise<void> | null = null;
let freshWanted = false;

/**
 * Reads the snapshot into the plugin's data. `fresh` asks the server for a new
 * read when its snapshot is a couple of seconds old, as the tab being shown
 * again does; a timed refresh takes the server's snapshot of up to 30 s. A call
 * while another runs joins it, and a `fresh` one runs once more after it. A
 * failed read keeps the snapshot held, so the rows keep their indicators.
 */
export function requestPorts(rpc: Rpc, fresh: boolean): Promise<void> {
  if (running !== null) {
    freshWanted ||= fresh;
    return running;
  }
  running = (async () => {
    try {
      let next = fresh;
      do {
        freshWanted = false;
        try {
          const parsed = portsSignalSchema.safeParse(await rpc.call("ports", { fresh: next }));
          if (parsed.success) pluginData.portsSignal(parsed.data);
        } catch {
          // The last snapshot stands.
        }
        next = true;
      } while (freshWanted);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Forgets a refresh in flight, as a reload of the app does. For tests. */
export function forgetPortsRequests(): void {
  running = null;
  freshWanted = false;
}

/** The refresh loop of one window's keeper; see `followPorts`. */
export interface PortsPage {
  isVisible(): boolean;
  /** Calls `listener` when the page is shown or hidden; returns the call that stops it. */
  onVisibilityChange(listener: () => void): () => void;
}

/**
 * Refreshes the snapshot while the page is visible: once now, 10 s after each
 * refresh completes, and at once, with `fresh`, when the page is shown again.
 * Nothing runs while the page is hidden. Returns the call that stops it.
 */
export function followPorts(rpc: Rpc, page: PortsPage, schedule: typeof setTimeout = setTimeout, cancel: typeof clearTimeout = clearTimeout): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Bumped by every restart and stop, so a refresh that completes after one does not schedule. */
  let round = 0;
  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const refresh = (fresh: boolean) => {
    clear();
    const mine = (round += 1);
    void requestPorts(rpc, fresh).then(() => {
      if (stopped || mine !== round || !page.isVisible()) return;
      timer = schedule(() => {
        timer = null;
        refresh(false);
      }, PORTS_REFRESH_MS);
    });
  };
  if (page.isVisible()) refresh(false);
  const unwatch = page.onVisibilityChange(() => {
    if (page.isVisible()) refresh(true);
    else {
      round += 1;
      clear();
    }
  });
  return () => {
    stopped = true;
    unwatch();
    clear();
  };
}

/** The document as `followPorts` sees the page. */
export const documentPage: PortsPage = {
  isVisible: () => document.visibilityState !== "hidden",
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
