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

const cwdSlug = z.string().min(1).max(4096).refine((s) => !s.includes("/") && s !== "." && s !== "..");

/** The plugin clock's jumps, so the host reads file and line times on the same clock; empty on wall time. */
const jumps = z.array(z.object({ at: z.number(), offset: z.number() }).strict()).max(10_000);

export const cursorSchema = z
  .object({
    cwdSlug,
    ino: z.number(),
    offset: z.number().int().min(0),
    fold: z
      .object({
        facts: factsSchema,
        lastKey: z.string().nullable(),
        contextAt: z.number().nullable(),
        keeperTurn: z.boolean(),
        awaitingRequest: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const hostContract = defineRpcContract({
  transcript: {
    input: z
      .object({
        sessionId,
        /** Where the last read stopped; null reads from the start. */
        cursor: cursorSchema.nullable(),
        jumps,
      })
      .strict(),
    output: z
      .object({
        found: z.boolean(),
        /** The project directory's name: Claude Code's slug of the session's working directory. */
        cwdSlug: z.string().nullable(),
        cursor: cursorSchema.nullable(),
        facts: factsSchema,
        /** The requests in the bytes this call read. */
        requests: z.array(requestSchema),
        bytesRead: z.number(),
        unreadable: z.string().nullable(),
      })
      .strict(),
  },
  tasks: {
    input: z
      .object({
        sessionId,
        cwdSlug,
        commands: z.array(taskId).max(64),
        subagents: z.array(taskId).max(64),
        jumps,
      })
      .strict(),
    output: z
      .object({
        commands: z.array(z.object({ id: z.string(), outputFile: z.string(), changedAt: z.number().nullable() }).strict()),
        subagents: z.array(z.object({ id: z.string(), lastTool: z.string().nullable(), changedAt: z.number().nullable() }).strict()),
      })
      .strict(),
  },
  /** Keeps the worker alive for `ms` more, replacing any earlier lease, while a deadline or stall check is pending on this machine. */
  retain: {
    input: z.object({ ms: z.number().int().min(0).max(60 * 60_000) }).strict(),
    output: z.object({ until: z.number() }).strict(),
  },
});
