// The one module that fetches: the plugin's calls to its own server, as `DashboardApi`.
// It hands the pages the dashboard's own views and channel names, so the wire's shape stops here.
// The calls are typed by the server's own RPC contract, so an input the server would refuse fails to compile.
import { useMemo } from "react";
import { useRpc, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/server";
import type { DashboardApi } from "@/src/fleet/application/views";

export { BOARD_CHANGED, INBOX_NEW } from "@/src/fleet/application/views";

type Contract = typeof rpcContract;

/** The part of bb's RPC client the dashboard uses. */
export type Caller = Pick<PluginRpcClient<Contract>, "call">;

/** `DashboardApi` over a caller: each method is the RPC method of the same name. */
export function createDashboardApi(rpc: Caller): DashboardApi {
  return {
    fleets: () => rpc.call("fleets", null),
    threadFleet: (input) => rpc.call("threadFleet", input),
    fleetDetail: (input) => rpc.call("fleetDetail", input),
    ledger: (input) => rpc.call("ledger", input),
    sendAction: (input) => rpc.call("sendAction", input),
    settings: () => rpc.call("settings", null),
    saveCredential: (input) => rpc.call("saveCredential", input),
    removeCredential: (input) => rpc.call("removeCredential", input),
    setInterval: (input) => rpc.call("setInterval", input),
  };
}

export function useDashboardApi(): DashboardApi {
  const rpc = useRpc<Contract>();
  return useMemo(() => createDashboardApi(rpc), [rpc]);
}
