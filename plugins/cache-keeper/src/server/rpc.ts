/** The frontend's calls to the server. `app.tsx` imports this contract's type only. */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { RowGlyph, ThreadView } from "../core/view";
import type { HistoryRow } from "./store";

const threadId = z.string().regex(/^thr_[A-Za-z0-9_-]+$/, "Not a thread id");
const setting = z.number().int().min(1).max(10);
const isObject = (v: unknown) => typeof v === "object" && v !== null;

export interface Totals {
  compactions: number;
  compactionUsd: number;
  keepWarms: number;
  checkIns: number;
  warmUsd: number;
  avoidedUsd: number;
}

export interface Overview {
  switchedOn: ThreadView[];
  waiting: ThreadView[];
  recent: (HistoryRow & { title: string })[];
  totals: Totals;
  checkIns: boolean;
}

export const rpcContract = defineRpcContract({
  view: {
    input: z.object({ threadId }).strict(),
    output: z.custom<ThreadView | null>((v) => v === null || isObject(v)),
  },
  setCompact: {
    input: z.object({ threadId, on: z.boolean(), setting: setting.optional() }).strict(),
    output: z.custom<ThreadView | null>((v) => v === null || isObject(v)),
  },
  setSetting: {
    input: z.object({ threadId, setting }).strict(),
    output: z.custom<ThreadView | null>((v) => v === null || isObject(v)),
  },
  skip: {
    input: z.object({ threadId, what: z.enum(["compaction", "warm"]), undo: z.boolean() }).strict(),
    output: z.custom<ThreadView | null>((v) => v === null || isObject(v)),
  },
  compactNow: {
    input: z.object({ threadId }).strict(),
    output: z.custom<ThreadView | null>((v) => v === null || isObject(v)),
  },
  rowStatuses: {
    input: z.null(),
    output: z.custom<RowGlyph[]>(Array.isArray),
  },
  overview: {
    input: z.null(),
    output: z.custom<Overview>(isObject),
  },
});

export type RpcContract = typeof rpcContract;
