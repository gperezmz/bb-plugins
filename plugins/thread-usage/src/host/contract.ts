/**
 * Host RPC contract shared by the server (`bb.hosts.experimental_client`) and
 * the host entry (`host.ts`). The host entry reads harness session logs on
 * the machine that ran a thread.
 */
import "../zod-locale";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";

export const harnessSchema = z.enum(["claude-code", "pi", "codex"]);
export type Harness = z.infer<typeof harnessSchema>;

const count = () => z.number().check(z.nonnegative());

export const logTokensSchema = z.strictObject({
  input: count(),
  output: count(),
  cacheRead: count(),
  cacheWrite: count(),
  cacheWrite1h: count(),
  reasoning: count(),
});

/** One model request as a harness log recorded it. */
export const logEntrySchema = z.strictObject({
  /** Stable dedup key within a session, e.g. `<message.id>:<requestId>`. */
  key: z.string().check(z.minLength(1)),
  /** The harness session id (bb's `providerThreadId`). */
  sessionId: z.string(),
  /** Null for the main session; the subagent id for subagent logs. */
  agentId: z.nullable(z.string()),
  /** Epoch ms of the request (the log line's timestamp). */
  ts: z.number(),
  model: z.nullable(z.string()),
  tokens: logTokensSchema,
  /** Cost the harness itself computed (pi), else null. */
  costUsd: z.nullable(z.number()),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const LOG_PAGE_MAX = 4000;

export const hostContract = defineRpcContract({
  probe: {
    input: z.null(),
    output: z.strictObject({
      home: z.string(),
      harnesses: z.strictObject({
        "claude-code": z.boolean(),
        pi: z.boolean(),
        codex: z.boolean(),
      }),
    }),
  },
  readSessionLogs: {
    input: z.strictObject({
      harness: harnessSchema,
      sessionIds: z
        .array(z.string().check(z.minLength(1), z.maxLength(200)))
        .check(z.minLength(1), z.maxLength(64)),
      /** Only entries with ts >= sinceMs (null: no lower bound). */
      sinceMs: z.nullable(z.number()),
      /** Only entries with ts < untilMs (null: no upper bound). */
      untilMs: z.nullable(z.number()),
      /** Include subagent logs (Claude Code only). */
      includeSubagents: z.boolean(),
      offset: z.number().check(z.int(), z.nonnegative()),
      limit: z.number().check(z.int(), z.positive(), z.maximum(LOG_PAGE_MAX)),
    }),
    output: z.strictObject({
      entries: z.array(logEntrySchema),
      /** Offset of the next page, or null when this was the last. */
      nextOffset: z.nullable(z.number().check(z.int())),
      /** Session ids for which at least one log file was found. */
      sessionsFound: z.array(z.string()),
    }),
  },
});
