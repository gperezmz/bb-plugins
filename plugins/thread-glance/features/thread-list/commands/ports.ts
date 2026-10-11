// The commands on the workspace ports: Stop on a hover card entry.
import { toast } from "sonner";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import type { PortTarget } from "@/shared/ports";
import { messageOf } from "@/lib/error-message";
import { STOP_PORT_TEXT } from "../model/ports";
import { requestPorts } from "../sync/ports-requests";

export interface PortCommands {
  /** Asks the server to stop the process on one listener of the thread's environment, toasts the outcome and refreshes the snapshot. */
  stopPort(threadId: string, target: PortTarget): Promise<void>;
}

export function createPortCommands(rpc: () => PluginRpcClient<RpcContract>): PortCommands {
  return {
    async stopPort(threadId, target) {
      try {
        const { outcome } = await rpc().call("stopPort", { threadId, ...target });
        if (outcome === "requested") {
          const text = STOP_PORT_TEXT.requested(target.port);
          toast.success(text.title, { description: text.description });
        } else {
          const text = STOP_PORT_TEXT[outcome](target.port);
          toast.error(text.title, { description: text.description });
        }
      } catch (error) {
        toast.error(messageOf(error, `Could not stop :${target.port}`));
      }
      await requestPorts(rpc(), true);
    },
  };
}
