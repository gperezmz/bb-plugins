/** The frontend's calls to the server. `app.tsx` imports this contract's type only. */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { RowGlyph, ThreadView } from "../core/view";
import { AGENT_TOOLS, type AgentToolKey, type AgentToolRow } from "./agent-tools";
import { KEEP_WARM_VALUES, WAIT_MINUTES, type KeeperSettings } from "./settings";
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
  /** Titles of the threads the recent entries' costs fell on. */
  titles: Record<string, string>;
  totals: Totals;
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
  /** Flips Keep warm while waiting on the thread's tree top; answers with the thread's view. */
  setKeepWarm: {
    input: z.object({ threadId, on: z.boolean() }).strict(),
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
  /** The Agent tools section's rows. */
  agentTools: {
    input: z.null(),
    output: z.custom<AgentToolRow[]>(Array.isArray),
  },
  setAgentTool: {
    input: z.object({ name: z.enum(Object.keys(AGENT_TOOLS) as [AgentToolKey, ...AgentToolKey[]]), on: z.boolean() }).strict(),
    output: z.custom<AgentToolRow[]>(Array.isArray),
  },
  /** The four settings the Waiting threads, Stalled tasks and Prices sections show. */
  settings: {
    input: z.null(),
    output: z.custom<KeeperSettings>(isObject),
  },
  /** Changes any of the four; answers with all four. */
  setSettings: {
    input: z
      .object({
        keepWarm: z.enum(KEEP_WARM_VALUES),
        checkIns: z.boolean(),
        waitMs: z.union(WAIT_MINUTES.map((m) => z.literal(m * 60_000))),
        fetchPrices: z.boolean(),
      })
      .partial()
      .strict(),
    output: z.custom<KeeperSettings>(isObject),
  },
});

export type RpcContract = typeof rpcContract;
