/**
 * Host RPC contract shared by the server (`bb.hosts.experimental_client`) and
 * the host entry (`host.ts`). The host entry reads harness session logs on
 * the machine that ran a thread.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const harnessSchema = z.enum(["claude-code", "pi", "codex"]);
export type Harness = z.infer<typeof harnessSchema>;

export const logTokensSchema = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    cacheWrite1h: z.number().nonnegative(),
    reasoning: z.number().nonnegative(),
  })
  .strict();

/** One model request as a harness log recorded it. */
export const logEntrySchema = z
  .object({
    /** Stable dedup key within a session, e.g. `<message.id>:<requestId>`. */
    key: z.string().min(1),
    /** The harness session id (bb's `providerThreadId`). */
    sessionId: z.string(),
    /** Null for the main session; the subagent id for subagent logs. */
    agentId: z.string().nullable(),
    /** Epoch ms of the request (the log line's timestamp). */
    ts: z.number(),
    model: z.string().nullable(),
    tokens: logTokensSchema,
    /** Cost the harness itself computed (pi), else null. */
    costUsd: z.number().nullable(),
  })
  .strict();
export type LogEntry = z.infer<typeof logEntrySchema>;

export const LOG_PAGE_MAX = 4000;

export const hostContract = defineRpcContract({
  probe: {
    input: z.null(),
    output: z
      .object({
        home: z.string(),
        harnesses: z
          .object({
            "claude-code": z.boolean(),
            pi: z.boolean(),
            codex: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  },
  readSessionLogs: {
    input: z
      .object({
        harness: harnessSchema,
        sessionIds: z.array(z.string().min(1).max(200)).min(1).max(64),
        /** Only entries with ts >= sinceMs (null: no lower bound). */
        sinceMs: z.number().nullable(),
        /** Only entries with ts < untilMs (null: no upper bound). */
        untilMs: z.number().nullable(),
        /** Include subagent logs (Claude Code only). */
        includeSubagents: z.boolean(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive().max(LOG_PAGE_MAX),
      })
      .strict(),
    output: z
      .object({
        entries: z.array(logEntrySchema),
        /** Offset of the next page, or null when this was the last. */
        nextOffset: z.number().int().nullable(),
        /** Session ids for which at least one log file was found. */
        sessionsFound: z.array(z.string()),
      })
      .strict(),
  },
});
