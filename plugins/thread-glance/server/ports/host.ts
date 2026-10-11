// The server's side of the host entry: scanning a machine and signalling a
// process on it. `PortsHost` is the port; the SDK adapter is the only code
// here that names `bb.hosts`.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, type HostListener, type HostSignalResult, type PortTarget } from "../../shared/ports";

export interface PortsHost {
  /** The listeners inside `workspaces` on a machine. Rejects when the machine cannot be scanned. */
  scan(hostId: string, workspaces: readonly string[]): Promise<{ supported: boolean; listeners: HostListener[] }>;
  /** Asks the machine to SIGTERM the process listening on `port` if it still has `pid` and `startedAt` inside `workspaces`. */
  signal(hostId: string, target: PortTarget & { workspaces: readonly string[] }): Promise<HostSignalResult>;
}

const SCAN_TIMEOUT_MS = 20_000;
const SIGNAL_TIMEOUT_MS = 10_000;

export function createSdkPortsHost(bb: Pick<BbPluginApi, "hosts">): PortsHost {
  const host = bb.hosts.experimental_client({ contract: defineRpcContract(hostContract) });
  return {
    scan: (hostId, workspaces) => host.call("scan", { workspaces: [...workspaces] }, { hostId, timeoutMs: SCAN_TIMEOUT_MS }),
    async signal(hostId, target) {
      const { result } = await host.call("signal", { ...target, workspaces: [...target.workspaces] }, { hostId, timeoutMs: SIGNAL_TIMEOUT_MS });
      return result;
    },
  };
}
