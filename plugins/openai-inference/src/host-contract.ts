/**
 * The host entry's contract: bb's AI-service methods and `configure`.
 *
 * The AI-service schemas copy `experimental_aiServicesHostContract` from
 * `@get-bb/plugin-sdk/ai-services`, as bb's own Codex plugin does: bb builds a
 * plugin installed from Git without its devDependencies, and without the SDK
 * package that subpath does not resolve. `test/host-contract.test.ts` checks
 * the copy against the SDK.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configureContract } from "./contract.js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));
const jsonObject = z.record(z.string(), json);

const failure = z
  .object({
    ok: z.literal(false),
    code: z.enum(["timeout", "rate_limited", "service_unavailable", "auth_required", "request_failed", "invalid_response"]),
    message: z.string().min(1),
  })
  .strict();

export const hostContract = defineRpcContract({
  "ai.inference.complete": {
    input: z
      .object({
        serviceId: z.string().min(1),
        model: z.string().min(1),
        reasoningEffort: z.literal("none"),
        prompt: z.string().min(1),
        outputSchema: jsonObject,
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.union([z.object({ ok: z.literal(true), model: z.string().min(1), value: jsonObject }).strict(), failure]),
  },
  "ai.voice.transcribe": {
    input: z
      .object({
        serviceId: z.string().min(1),
        model: z.string().min(1),
        audioBase64: z.string().min(1),
        mimeType: z.string().min(1),
        filename: z.string().min(1),
        prompt: z.string().nullable(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.union([z.object({ ok: z.literal(true), model: z.string().min(1), text: z.string() }).strict(), failure]),
  },
  ...configureContract,
});
