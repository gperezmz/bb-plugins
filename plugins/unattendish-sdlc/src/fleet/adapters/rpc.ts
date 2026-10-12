// The dashboard's calls over the wire: `DashboardApi` as an RPC contract the
// plugin's pages import the type of, and the handlers that delegate to it.
// Inputs are strict; outputs are the views, checked only for being objects,
// since the use cases build them.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import { LEDGER_LIMIT } from "../application/dashboard";
import { ACTION_TEXT_MAX_CHARS } from "../domain/actions";
import type {
  ActionRecordView,
  ConnectInput,
  ConnectResult,
  ConnectTarget,
  ConnectView,
  DashboardApi,
  HalfView,
  NotReadableView,
  RevokeNotice,
  TokenPageView,
  FleetDetailView,
  FleetsView,
  LedgerFilter,
  LedgerView,
  Result,
  SettingsView,
  ThreadFleetView,
} from "../application/views";

const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;
const text = (max: number) => z.string().check(z.maxLength(max));
const repo = text(300);
const service = z.enum(["github", "gitlab", "linear", "jira"]);
const role = z.enum(["forge", "tracker"]);
const host = text(253);
const id = text(100);
/** A pasted token or key: bounded, and never echoed back by any method. */
const secretText = text(10_000);
const target = {
  fleet: z.optional(repo),
  role: z.optional(role),
  service: z.optional(service),
  place: z.optional(host),
  owner: z.optional(text(100)),
};
const accountChoice = z.union([z.strictObject({ id }), z.strictObject({ service, place: host })]);
const done = z.enum(["woke", "echo", "out-of-scope", "held", "failed read"]);

export const rpcContract = defineRpcContract({
  fleets: {
    input: z.null(),
    output: z.custom<FleetsView>(isObject),
  },
  threadFleet: {
    input: z.strictObject({ threadId: text(200) }),
    output: z.custom<ThreadFleetView>(isObject),
  },
  fleetDetail: {
    input: z.strictObject({ repo }),
    output: z.custom<Result<{ detail: FleetDetailView }>>(isObject),
  },
  ledger: {
    input: z.strictObject({
      repo,
      filter: z.optional(z.strictObject({ item: z.optional(text(300)), done: z.optional(done), limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(LEDGER_LIMIT))) })),
    }),
    output: z.custom<Result<{ ledger: LedgerView }>>(isObject),
  },
  sendAction: {
    input: z.strictObject({
      fleet: repo,
      rowId: text(1000),
      kind: z.enum(["answer", "grant", "build"]),
      text: z.optional(text(ACTION_TEXT_MAX_CHARS)),
      regrant: z.optional(z.boolean()),
    }),
    output: z.custom<Result<{ action: ActionRecordView }>>(isObject),
  },
  settings: {
    input: z.null(),
    output: z.custom<SettingsView>(isObject),
  },
  connectView: {
    input: z.strictObject(target),
    output: z.custom<Result<{ connect: ConnectView }>>(isObject),
  },
  tokenPage: {
    input: z.strictObject({ ...target, account: accountChoice }),
    output: z.custom<Result<{ page: TokenPageView }>>(isObject),
  },
  cliLogins: {
    input: z.strictObject({ tool: z.enum(["gh", "glab"]), host }),
    output: z.custom<{ logins: readonly string[] }>(isObject),
  },
  connect: {
    input: z.strictObject({
      ...target,
      account: z.union([z.strictObject({ id }), z.strictObject({ service, place: host, apiUrl: z.optional(text(2000)) })]),
      secret: z.union([
        z.strictObject({ kind: z.literal("token"), token: secretText }),
        z.strictObject({ kind: z.literal("jira"), email: text(320), token: secretText }),
        z.strictObject({ kind: z.literal("login"), tool: z.enum(["gh", "glab"]), login: text(100) }),
        z.strictObject({ kind: z.literal("stored") }),
      ]),
      confirm: z.optional(z.boolean()),
      replaces: z.optional(id),
    }),
    output: z.custom<ConnectResult>(isObject),
  },
  checkAgain: {
    input: z.strictObject({ fleet: repo, role }),
    output: z.custom<Result<{ half: HalfView; notReadable: readonly NotReadableView[] }>>(isObject),
  },
  makeDefault: {
    input: z.strictObject({ accountId: id }),
    output: z.custom<Result<{ settings: SettingsView }>>(isObject),
  },
  removeAssignment: {
    input: z.strictObject({ scope: text(300) }),
    output: z.custom<Result<{ settings: SettingsView }>>(isObject),
  },
  removeCredential: {
    input: z.strictObject({ credentialId: id }),
    output: z.custom<Result<{ settings: SettingsView; revoke: RevokeNotice }>>(isObject),
  },
  removeAccount: {
    input: z.strictObject({ accountId: id }),
    output: z.custom<Result<{ settings: SettingsView; revoke: RevokeNotice | null }>>(isObject),
  },
  setInterval: {
    input: z.strictObject({ repo, seconds: z.nullable(z.number()) }),
    output: z.custom<Result<{ settings: SettingsView }>>(isObject),
  },
});

export type RpcContract = typeof rpcContract;

/** Fails to compile when the contract and `DashboardApi` do not carry the same methods. */
const _sameMethods: [keyof RpcContract] extends [keyof DashboardApi] ? ([keyof DashboardApi] extends [keyof RpcContract] ? true : never) : never = true;
void _sameMethods;

/** The most an answer may weigh, as `fleet ledger` is held under bb's 1 MiB limit on what a command prints. */
export const MAX_ANSWER_BYTES = 900 * 1024;

/** The answer, or a refusal to send one the wire would not carry. */
const bounded = async <T>(answer: Promise<T>): Promise<T> => {
  const value = await answer;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_ANSWER_BYTES) throw new Error("the answer is too large to send");
  return value;
};

/** Each call of the contract delegating to the use case of the same name. */
export const rpcHandlers = (api: DashboardApi) => ({
  fleets: () => bounded(api.fleets()),
  threadFleet: (input: { threadId: string }) => bounded(api.threadFleet(input)),
  fleetDetail: (input: { repo: string }) => bounded(api.fleetDetail(input)),
  ledger: (input: { repo: string; filter?: LedgerFilter | undefined }) => bounded(api.ledger(input.filter === undefined ? { repo: input.repo } : { repo: input.repo, filter: input.filter })),
  sendAction: (input: Parameters<DashboardApi["sendAction"]>[0]) => bounded(api.sendAction(input)),
  settings: () => bounded(api.settings()),
  connectView: (input: ConnectTarget) => bounded(api.connectView(input)),
  tokenPage: (input: Parameters<DashboardApi["tokenPage"]>[0]) => bounded(api.tokenPage(input)),
  cliLogins: (input: { tool: "gh" | "glab"; host: string }) => bounded(api.cliLogins(input)),
  connect: (input: ConnectInput) => bounded(api.connect(input)),
  checkAgain: (input: Parameters<DashboardApi["checkAgain"]>[0]) => bounded(api.checkAgain(input)),
  makeDefault: (input: { accountId: string }) => bounded(api.makeDefault(input)),
  removeAssignment: (input: { scope: string }) => bounded(api.removeAssignment(input)),
  removeCredential: (input: { credentialId: string }) => bounded(api.removeCredential(input)),
  removeAccount: (input: { accountId: string }) => bounded(api.removeAccount(input)),
  setInterval: (input: { repo: string; seconds: number | null }) => bounded(api.setInterval(input)),
});
