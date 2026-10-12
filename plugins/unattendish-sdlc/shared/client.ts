// The one module that fetches: the plugin's calls to its own server, as `DashboardApi`.
// It hands the pages the dashboard's own views and channel names, so the wire's shape stops here.
// `useRpc` is untyped on purpose until the server exports its RPC contract; then
// `useRpc<typeof rpcContract>()` types every call below.
import { useMemo } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DashboardApi } from "@/src/fleet/application/views";

export { BOARD_CHANGED, INBOX_NEW } from "@/src/fleet/application/views";

/** The part of bb's RPC client the dashboard uses. */
export interface Caller {
  call(method: string, input: unknown): Promise<unknown>;
}

/** `DashboardApi` over a caller: each method is the RPC method of the same name. */
export function createDashboardApi(rpc: Caller): DashboardApi {
  return {
    fleets: () => rpc.call("fleets", {}) as ReturnType<DashboardApi["fleets"]>,
    threadFleet: (input) => rpc.call("threadFleet", input) as ReturnType<DashboardApi["threadFleet"]>,
    fleetDetail: (input) => rpc.call("fleetDetail", input) as ReturnType<DashboardApi["fleetDetail"]>,
    ledger: (input) => rpc.call("ledger", input) as ReturnType<DashboardApi["ledger"]>,
    sendAction: (input) => rpc.call("sendAction", input) as ReturnType<DashboardApi["sendAction"]>,
    settings: () => rpc.call("settings", {}) as ReturnType<DashboardApi["settings"]>,
    saveCredential: (input) => rpc.call("saveCredential", input) as ReturnType<DashboardApi["saveCredential"]>,
    removeCredential: (input) => rpc.call("removeCredential", input) as ReturnType<DashboardApi["removeCredential"]>,
    setInterval: (input) => rpc.call("setInterval", input) as ReturnType<DashboardApi["setInterval"]>,
  };
}

export function useDashboardApi(): DashboardApi {
  const rpc = useRpc() as unknown as Caller;
  return useMemo(() => createDashboardApi(rpc), [rpc]);
}
