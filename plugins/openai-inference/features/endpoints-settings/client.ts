// The one module that calls the server: the section's calls to the plugin's own server, in the section's words.
// The calls are typed by the server's own RPC contract, so an input the server would refuse fails to compile.
import { useMemo } from "react";
import { useRpc, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { Endpoint } from "@/src/endpoints";
import type { pageContract } from "@/server";
import type { draftOf } from "./model";

type Contract = typeof pageContract;

export type Draft = ReturnType<typeof draftOf>;

/** The Endpoints as saved, with what the section says about the old settings, if anything. */
export interface Saved {
  endpoints: Endpoint[];
  notice: string | null;
}

/** What a change came to: the Endpoints now saved, or why it was refused. */
export type Change =
  | { ok: true; endpoints: Endpoint[] }
  | { ok: false; fields: Partial<Record<"id" | "url" | "model" | "key", string>> }
  | { ok: false; problem: string };

export interface EndpointsApi {
  endpoints(): Promise<Saved>;
  /** Saves `draft` as a new Endpoint (`create`) or over the saved one with its id. */
  save(draft: Draft, create: boolean): Promise<Change>;
  remove(id: string): Promise<Change>;
}

/** The part of bb's RPC client the section uses. */
export type Caller = Pick<PluginRpcClient<Contract>, "call">;

export function createEndpointsApi(rpc: Caller): EndpointsApi {
  return {
    endpoints: () => rpc.call("endpoints", null),
    save: (draft, create) => rpc.call("saveEndpoint", { draft, create }),
    remove: (id) => rpc.call("removeEndpoint", { id }),
  };
}

export function useEndpointsApi(): EndpointsApi {
  const rpc = useRpc<Contract>();
  return useMemo(() => createEndpointsApi(rpc), [rpc]);
}

/** What a failed call says. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
