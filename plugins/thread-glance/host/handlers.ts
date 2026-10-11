// The host entry's handlers for `hostContract`.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "../shared/ports";
import { createSystemProbe, type HostProbe } from "./probe";
import { nodeSystem } from "./system";
import { scanListeners, signalListener } from "./scan";

export function createHostEntry(probe: HostProbe = createSystemProbe(nodeSystem), kill: (pid: number, signal: "SIGTERM") => void = process.kill) {
  return experimental_defineHostEntry({
    contract: defineRpcContract(hostContract),
    handlers: {
      scan: ({ workspaces }) => scanListeners(probe, workspaces),
      signal: async (input) => ({ result: await signalListener(probe, kill, input) }),
    },
  });
}
