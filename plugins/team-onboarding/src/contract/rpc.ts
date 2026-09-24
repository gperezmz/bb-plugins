// The contract between the Onboarding UI and the server. Shared by server.ts
// (validation) and the app (types only).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { FIX_KINDS, fixSchema, GROUPS, resultSchema, STATUSES } from "../core/model.js";

const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  isServer: z.boolean(),
  online: z.boolean(),
  lastSeenAt: z.string().nullable(),
  /** False when the host entry can't load there (checks fall back to terminals). */
  hostEntry: z.boolean(),
  /** Offline for over a week: its items are skipped until it returns. */
  longOffline: z.boolean(),
});

const commandSchema = z.object({
  role: z.enum(["run", "fix", "install", "source"]),
  text: z.string(),
  ref: z.string().nullable(),
  hash: z.string(),
  approved: z.boolean(),
});

const itemSchema = z.object({
  id: z.string(),
  group: z.enum(GROUPS),
  title: z.string(),
  why: z.string(),
  required: z.boolean(),
  estimate: z.string(),
  status: z.enum(STATUSES),
  results: z.array(resultSchema),
  /** Fixes per machine, primary first. */
  fixes: z.array(z.object({ hostId: z.string(), fixes: z.array(fixSchema) })),
  commands: z.array(commandSchema),
});
export type ItemState = z.infer<typeof itemSchema>;

const badgeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), count: z.number() }),
  z.object({ kind: z.literal("dot"), updates: z.number() }),
  z.object({ kind: z.literal("done") }),
]);

const deviceLoginSchema = z.object({
  loginId: z.string(),
  hostId: z.string(),
  itemId: z.string(),
  flow: z.enum(["login", "refresh"]),
  state: z.enum(["starting", "code", "done", "failed", "expired", "cancelled"]),
  code: z.string().nullable(),
  url: z.string().nullable(),
  expiresAt: z.string().nullable(),
  message: z.string().nullable(),
});
export type DeviceLoginState = z.infer<typeof deviceLoginSchema>;

const manifestStateSchema = z.object({
  status: z.enum(["none", "ok", "error", "loading"]),
  teamName: z.string().nullable(),
  /** sha256 of the manifest file. */
  version: z.string().nullable(),
  loadedAt: z.string().nullable(),
  error: z.string().nullable(),
  /** The file on the bb server the plugin reads the manifest from. */
  path: z.string(),
  githubMode: z.enum(["builtin", "per-machine"]),
  docsUrl: z.string().nullable(),
});

const terminalSchema = z.object({
  terminalId: z.string(),
  hostId: z.string(),
  itemId: z.string().nullable(),
  title: z.string(),
  command: z.string().nullable(),
  status: z.string(),
  exitCode: z.number().nullable(),
});
export type TrackedTerminalState = z.infer<typeof terminalSchema>;

const stateSchema = z.object({
  manifest: manifestStateSchema,
  machines: z.array(machineSchema),
  items: z.array(itemSchema),
  badge: badgeSchema,
  progress: z.object({ done: z.number(), total: z.number() }),
  nextStep: z
    .object({ itemId: z.string(), hostId: z.string().nullable() })
    .nullable(),
  homeLine: z.string(),
  doneSummary: z.string(),
  lastCheckAt: z.string().nullable(),
  running: z.boolean(),
  account: z.object({ login: z.string().nullable() }),
  deviceLogin: deviceLoginSchema.nullable(),
  safeFixes: z.array(
    z.object({ itemId: z.string(), hostId: z.string(), kind: z.enum(FIX_KINDS), label: z.string(), title: z.string(), machine: z.string() }),
  ),
  terminals: z.array(terminalSchema),
  watching: z.array(z.string()),
});
export type OnboardingState = z.infer<typeof stateSchema>;

const summarySchema = z.object({
  badge: badgeSchema,
  homeLine: z.string(),
  hasBlocking: z.boolean(),
  hasUpdates: z.boolean(),
  lastCheckAt: z.string().nullable(),
});
export type OnboardingSummary = z.infer<typeof summarySchema>;

const okSchema = z.object({ ok: z.boolean(), message: z.string().nullable() });

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateSchema },
  summary: { input: z.null(), output: summarySchema },
  recheck: {
    input: z.object({ itemId: z.string().optional(), hostId: z.string().optional() }).strict(),
    output: okSchema,
  },
  /** Safe fixes only; everything else goes through `ACTIONS_PATH`. */
  runFix: {
    input: z
      .object({
        itemId: z.string().max(200),
        hostId: z.string().max(100),
        kind: z.enum(FIX_KINDS),
        confirmed: z.boolean().default(false),
        cols: z.number().int().min(20).max(500).default(100),
        rows: z.number().int().min(5).max(200).default(30),
      })
      .strict(),
    output: okSchema.extend({
      terminal: z.object({ terminalId: z.string(), hostId: z.string() }).nullable(),
      loginId: z.string().nullable(),
    }),
  },
  fixAllSafe: {
    input: z.object({ hostId: z.string().optional(), dryRun: z.boolean() }).strict(),
    output: z.object({
      planned: z.array(z.object({ itemId: z.string(), hostId: z.string(), label: z.string(), title: z.string(), machine: z.string() })),
      results: z.array(z.object({ itemId: z.string(), hostId: z.string(), ok: z.boolean(), message: z.string().nullable() })),
    }),
  },
  cancelDeviceLogin: { input: z.object({ loginId: z.string() }).strict(), output: okSchema },
  details: {
    input: z.object({ itemId: z.string(), hostId: z.string() }).strict(),
    output: z.object({
      text: z.string().nullable(),
      links: z.array(z.object({ label: z.string(), url: z.string() })),
    }),
  },
  skillsDiff: {
    input: z.object({ itemId: z.string() }).strict(),
    output: z.object({
      added: z.array(z.string()),
      changed: z.array(z.string()),
      removed: z.array(z.string()),
      diffs: z.array(z.object({ folder: z.string(), diff: z.string() })),
    }),
  },
  manifestView: {
    input: z.null(),
    output: z.object({
      text: z.string().nullable(),
      version: z.string().nullable(),
      path: z.string(),
      sections: z.array(z.object({ title: z.string(), entries: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string() })) })),
      commands: z.array(commandSchema.extend({ itemId: z.string(), itemTitle: z.string() })),
      issues: z.array(z.object({ message: z.string(), path: z.string(), line: z.number().nullable() })),
    }),
  },
  watch: {
    input: z.object({ itemId: z.string(), hostId: z.string() }).strict(),
    output: okSchema,
  },
  /** The manifest file as Settings shows it: where, whether it exists, its hash and problems. */
  manifestFile: {
    input: z.null(),
    output: z.object({
      path: z.string(),
      exists: z.boolean(),
      sha: z.string().nullable(),
      mtime: z.string().nullable(),
      issues: z.array(z.string()),
    }),
  },
});

export type RpcContract = typeof rpcContract;

const size = {
  cols: z.number().int().min(20).max(500).default(100),
  rows: z.number().int().min(5).max(200).default(30),
};

/**
 * Everything that needs the engineer: approvals, fixes outside the safe list,
 * logins, machine variables, terminals. Not RPC — `bb plugin rpc call`
 * reaches every RPC method, so an agent could use it — but one HTTP route
 * that only takes same-origin browser fetches (see server.ts).
 */
export const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), hash: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ action: z.literal("revoke"), hash: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z
    .object({
      action: z.literal("runFix"),
      itemId: z.string().max(200),
      hostId: z.string().max(100),
      kind: z.enum(FIX_KINDS),
      confirmed: z.boolean().default(false),
      ...size,
    })
    .strict(),
  z.object({ action: z.literal("setEnv"), name: z.string().regex(/^[A-Z_][A-Z0-9_]*$/), value: z.string().min(1).max(16384) }).strict(),
  z.object({ action: z.literal("closeTerminal"), terminalId: z.string() }).strict(),
  z.object({ action: z.literal("forgetMachine"), hostId: z.string() }).strict(),
  z.object({ action: z.literal("recheck"), itemId: z.string().max(200), hostId: z.string().max(100) }).strict(),
]);
export type ActionInput = z.input<typeof actionInput>;
export const ACTIONS_PATH = "/actions";

/** What the actions route answers; fields depend on the action. */
export interface ActionResult {
  ok: boolean;
  message: string | null;
  terminal?: { terminalId: string; hostId: string } | null;
  loginId?: string | null;
}

/** Realtime channels. Payloads carry invalidations and the device code only. */
export const CHANGED_CHANNEL = "team-onboarding.changed";
export const DEVICE_CHANNEL = "team-onboarding.device";
