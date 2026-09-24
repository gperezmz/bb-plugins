/**
 * The frontend data plane. `app.tsx` imports this contract's type only.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type {
  ChipView,
  ConnectionCheck,
  PricesInfo,
  SettingsStatus,
  ThreadReport,
  TopFamily,
} from "../core/report-types";

const threadId = z.string().regex(/^thr_[A-Za-z0-9_-]+$/, "Not a thread id");
const isObject = (v: unknown) => typeof v === "object" && v !== null;

export const rpcContract = defineRpcContract({
  report: {
    input: z.object({ threadId }).strict(),
    output: z.custom<ThreadReport>(isObject),
  },
  chip: {
    input: z.object({ threadId }).strict(),
    output: z.custom<ChipView>(isObject),
  },
  claimToast: {
    input: z.object({ rootThreadId: threadId, amount: z.number().positive() }).strict(),
    output: z.object({ claimed: z.boolean() }),
  },
  refresh: {
    input: z.object({ threadId }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  top: {
    input: z
      .object({ projectId: z.string().nullable(), sinceDays: z.number().int().min(1).max(3650) })
      .strict(),
    output: z.custom<{ families: TopFamily[]; projects: { id: string; name: string }[]; prices: PricesInfo }>(isObject),
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
    input: z.object({ action: z.enum(["pause", "resume", "retry-failed"]) }).strict(),
    output: z.custom<SettingsStatus>(isObject),
  },
  exportAll: {
    input: z.null(),
    output: z.object({ json: z.string(), csv: z.string(), threads: z.number() }),
  },
});

export type RpcContract = typeof rpcContract;
