/**
 * Host RPC contract shared by the server (`bb.hosts.experimental_client`) and
 * the host entry (`host.ts`), which reads Claude Code's files on the machine
 * that runs a thread.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const requestSchema = z
  .object({
    at: z.number(),
    model: z.string().nullable(),
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite5m: z.number(),
    cacheWrite1h: z.number(),
  })
  .strict();

export const factsSchema = z
  .object({
    lastRequestAt: z.number().nullable(),
    lifetime: z.enum(["5m", "1h"]).nullable(),
    context: z.number().nullable(),
    model: z.string().nullable(),
    requests: z.number(),
    userMessages: z.number(),
    lastCompaction: z.object({ at: z.number(), preTokens: z.number().nullable(), postTokens: z.number() }).strict().nullable(),
  })
  .strict();

export const hostContract = defineRpcContract({
  transcript: {
    input: z
      .object({
        sessionId,
        /** Also return the requests at or after this time. */
        requestsSince: z.number().nullable(),
      })
      .strict(),
    output: z
      .object({
        found: z.boolean(),
        /** The project directory's name: Claude Code's slug of the session's working directory. */
        cwdSlug: z.string().nullable(),
        facts: factsSchema,
        requests: z.array(requestSchema),
      })
      .strict(),
  },
  tasks: {
    input: z
      .object({
        sessionId,
        cwdSlug: z.string().min(1).max(4096).refine((s) => !s.includes("/") && s !== "." && s !== ".."),
        commands: z.array(taskId).max(64),
        subagents: z.array(taskId).max(64),
      })
      .strict(),
    output: z
      .object({
        commands: z.array(z.object({ id: z.string(), outputFile: z.string(), changedAt: z.number().nullable() }).strict()),
        subagents: z.array(z.object({ id: z.string(), lastTool: z.string().nullable(), changedAt: z.number().nullable() }).strict()),
      })
      .strict(),
  },
});
