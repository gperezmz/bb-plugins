// The feature's one edge to the server.
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";

export function useTweaksRpc() {
  return useRpc<RpcContract>();
}
