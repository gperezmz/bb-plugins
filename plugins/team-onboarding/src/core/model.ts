// Wire schemas for the shared vocabulary in vocab.ts.
import { z } from "zod";
import { FIX_KINDS, STATUSES } from "./vocab.js";

export * from "./vocab.js";

export const resultSchema = z.object({
  itemId: z.string(),
  hostId: z.string(),
  status: z.enum(STATUSES),
  category: z.string(),
  checkedAt: z.string().nullable(),
  detail: z.string(),
  facts: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  ),
});

export const fixSchema = z.object({
  kind: z.enum(FIX_KINDS),
  label: z.string(),
  command: z.string().nullable(),
  url: z.string().nullable(),
  safe: z.boolean(),
  approvalHash: z.string().nullable(),
  confirm: z.string().nullable(),
});

