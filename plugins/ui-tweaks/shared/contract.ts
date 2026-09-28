// RPC contract between the app and the server. The app imports this module
// for its types only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { TEXT_SIZES, WIDTHS } from "./tweaks";

const tweaksSchema = z.object({ textSize: z.enum(TEXT_SIZES), width: z.enum(WIDTHS) }).strict();

export const rpcContract = defineRpcContract({
  getTweaks: {
    input: z.null(),
    output: tweaksSchema,
  },
  /** Stores the tweaks named in the input and returns both as they now stand. */
  setTweaks: {
    input: tweaksSchema.partial(),
    output: tweaksSchema,
  },
});

export type RpcContract = typeof rpcContract;
