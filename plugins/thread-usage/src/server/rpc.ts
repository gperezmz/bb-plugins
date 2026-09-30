/**
 * The frontend data plane. `app.tsx` imports this contract's type only.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import type {
  ChipView,
  ConnectionCheck,
  PricesInfo,
  SettingsStatus,
  ThreadReport,
  TopTree,
} from "../core/report-types";

const threadId = z.string().check(z.regex(/^thr_[A-Za-z0-9_-]+$/, "Not a thread id"));
const isObject = (v: unknown) => typeof v === "object" && v !== null;

export const rpcContract = defineRpcContract({
  report: {
    input: z.strictObject({ threadId }),
    output: z.custom<ThreadReport>(isObject),
  },
  chip: {
    input: z.strictObject({ threadId }),
    output: z.custom<ChipView>(isObject),
  },
  claimToast: {
    input: z.strictObject({ rootThreadId: threadId, amount: z.number().check(z.positive()) }),
    output: z.object({ claimed: z.boolean() }),
  },
  refresh: {
    input: z.strictObject({ threadId }),
    output: z.object({ ok: z.boolean() }),
  },
  top: {
    input: z.strictObject({
      projectId: z.nullable(z.string()),
      sinceDays: z.number().check(z.int(), z.minimum(1), z.maximum(3650)),
    }),
    output: z.custom<{ trees: TopTree[]; projects: { id: string; name: string }[]; prices: PricesInfo }>(isObject),
  },
  status: {
    input: z.null(),
    output: z.custom<SettingsStatus>(isObject),
  },
  testConnection: {
    input: z.null(),
    output: z.custom<{ checks: ConnectionCheck[]; adapter: "none" | "litellm" }>(isObject),
  },
  backfill: {
    input: z.strictObject({ action: z.enum(["pause", "resume", "retry-failed"]) }),
    output: z.custom<SettingsStatus>(isObject),
  },
  exportAll: {
    input: z.null(),
    output: z.object({ json: z.string(), csv: z.string(), threads: z.number() }),
  },
});

export type RpcContract = typeof rpcContract;
