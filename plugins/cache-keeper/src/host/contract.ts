/**
 * Host RPC contract shared by the server (`bb.hosts.experimental_client`) and
 * the host entry (`host.ts`), which reads Claude Code's files on the machine
 * that runs a thread.
 *
 * A transcript read is on the hot path of every turn's end, so its cursor
 * and its reply are checked by hand rather than by Zod: every field either
 * side acts on is checked for its type, and a reply that fails is refused
 * the same way Zod would refuse it.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { TranscriptCursor, TranscriptFacts, TranscriptRequest } from "../core/transcript";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNullableNumber = (v: unknown) => v === null || isNumber(v);
const isNullableString = (v: unknown) => v === null || typeof v === "string";

/** A project directory's name, never a path. */
export const isCwdSlug = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 4096 && !v.includes("/") && v !== "." && v !== "..";

export function isRequest(v: unknown): v is TranscriptRequest {
  return (
    isObject(v) &&
    isNumber(v.at) &&
    isNullableString(v.model) &&
    isNumber(v.input) &&
    isNumber(v.output) &&
    isNumber(v.cacheRead) &&
    isNumber(v.cacheWrite5m) &&
    isNumber(v.cacheWrite1h)
  );
}

export function isFacts(v: unknown): v is TranscriptFacts {
  if (!isObject(v)) return false;
  const c = v.lastCompaction;
  return (
    isNullableNumber(v.lastRequestAt) &&
    (v.lifetime === null || v.lifetime === "5m" || v.lifetime === "1h") &&
    isNullableNumber(v.context) &&
    isNullableString(v.model) &&
    isNumber(v.requests) &&
    isNumber(v.userMessages) &&
    (c === null || (isObject(c) && isNumber(c.at) && isNullableNumber(c.preTokens) && isNumber(c.postTokens)))
  );
}

export function isCursor(v: unknown): v is TranscriptCursor {
  if (!isObject(v) || !isCwdSlug(v.cwdSlug) || !isNumber(v.ino) || !Number.isInteger(v.offset) || (v.offset as number) < 0) return false;
  const f = v.fold;
  return isObject(f) && isFacts(f.facts) && isNullableString(f.lastKey) && isNullableNumber(f.contextAt) && typeof f.keeperTurn === "boolean" && typeof f.awaitingRequest === "boolean";
}

/** What a transcript read answers. */
export interface TranscriptReply {
  found: boolean;
  /** The project directory's name: Claude Code's slug of the session's working directory. */
  cwdSlug: string | null;
  cursor: TranscriptCursor | null;
  facts: TranscriptFacts;
  /** The requests in the bytes this call read. */
  requests: TranscriptRequest[];
  bytesRead: number;
  unreadable: string | null;
}

export function isTranscriptReply(v: unknown): v is TranscriptReply {
  return (
    isObject(v) &&
    typeof v.found === "boolean" &&
    (v.cwdSlug === null || isCwdSlug(v.cwdSlug)) &&
    (v.cursor === null || isCursor(v.cursor)) &&
    isFacts(v.facts) &&
    Array.isArray(v.requests) &&
    v.requests.every(isRequest) &&
    isNumber(v.bytesRead) &&
    isNullableString(v.unreadable)
  );
}

/** The plugin clock's jumps, so the host reads file and line times on the same clock; empty on wall time. */
export const isJumps = (v: unknown): v is { at: number; offset: number }[] => Array.isArray(v) && v.length <= 10_000 && v.every((j) => isObject(j) && isNumber(j.at) && isNumber(j.offset));

const checked = <T>(check: (v: unknown) => v is T, what: string) => z.custom<T>(check, { message: `not ${what}` });
const cwdSlug = checked(isCwdSlug, "a project directory's name");
const jumps = checked(isJumps, "the clock's jumps");

export const hostContract = defineRpcContract({
  transcript: {
    input: z
      .object({
        sessionId,
        /** Where the last read stopped; null reads from the start. */
        cursor: z.custom<TranscriptCursor | null>((v) => v === null || isCursor(v), { message: "not a transcript cursor" }),
        jumps,
      })
      .strict(),
    output: checked(isTranscriptReply, "a transcript read"),
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
