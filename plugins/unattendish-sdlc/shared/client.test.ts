import { describe, expect, it } from "vitest";
import { rpcContract } from "@/src/fleet/adapters/rpc";
import type { DashboardApi } from "@/src/fleet/application/views";
import { createDashboardApi, type Caller } from "./client";

type Method = keyof DashboardApi;
interface Seen {
  readonly method: string;
  readonly input: unknown;
  /** The issues the server's own schema found with the input; none means it accepts it. */
  readonly issues: readonly unknown[];
}

/** A caller that asks the server's contract whether it would accept each call, and answers with an empty view. */
function validatingCaller(seen: Seen[]): Caller {
  const call = async (method: string, input: unknown) => {
    const schema = (rpcContract as Record<string, { input: { "~standard": { validate(value: unknown): unknown } } }>)[method]!.input["~standard"];
    const result = (await schema.validate(input)) as { issues?: readonly unknown[] };
    seen.push({ method, input, issues: result.issues ?? [] });
    return {};
  };
  return { call } as unknown as Caller;
}

/** Each method of the dashboard, called with a typical input, and the variants whose optional fields the pages fill. */
const TYPICAL: Record<Method, ((api: DashboardApi) => Promise<unknown>)[]> = {
  fleets: [(api) => api.fleets()],
  threadFleet: [(api) => api.threadFleet({ threadId: "thr_abc123" })],
  fleetDetail: [(api) => api.fleetDetail({ repo: "github.com/acme/web" })],
  ledger: [
    (api) => api.ledger({ repo: "github.com/acme/web" }),
    (api) => api.ledger({ repo: "github.com/acme/web", filter: {} }),
    (api) => api.ledger({ repo: "github.com/acme/web", filter: { item: "#163", done: "woke" } }),
    (api) => api.ledger({ repo: "github.com/acme/web", filter: { done: "failed read", limit: 250 } }),
  ],
  sendAction: [
    (api) => api.sendAction({ fleet: "github.com/acme/web", rowId: "row_1", kind: "answer", text: "en-GB\nbecause the spec says so" }),
    (api) => api.sendAction({ fleet: "github.com/acme/web", rowId: "row_1", kind: "grant", text: "merge it" }),
    (api) => api.sendAction({ fleet: "github.com/acme/web", rowId: "row_1", kind: "grant", regrant: true }),
    (api) => api.sendAction({ fleet: "github.com/acme/web", rowId: "row_1", kind: "build" }),
  ],
  settings: [(api) => api.settings()],
  connectView: [
    (api) => api.connectView({ fleet: "github.com/acme/web", role: "forge" }),
    (api) => api.connectView({ service: "github", place: "github.com", owner: "zorg" }),
    (api) => api.connectView({ service: "jira", place: "acme.atlassian.net" }),
  ],
  tokenPage: [
    (api) => api.tokenPage({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_1" } }),
    (api) => api.tokenPage({ service: "github", place: "github.com", owner: "zorg", account: { service: "github", place: "github.com" } }),
  ],
  cliLogins: [(api) => api.cliLogins({ tool: "gh", host: "github.com" }), (api) => api.cliLogins({ tool: "glab", host: "gitlab.example.com" })],
  connect: [
    (api) => api.connect({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_1" }, secret: { kind: "token", token: "fake-token" } }),
    (api) => api.connect({ fleet: "github.com/acme/web", role: "forge", account: { service: "github", place: "github.com" }, secret: { kind: "token", token: "fake-token" }, confirm: true }),
    (api) => api.connect({ service: "jira", place: "acme.atlassian.net", account: { service: "jira", place: "acme.atlassian.net" }, secret: { kind: "jira", email: "ops@acme.com", token: "fake-token" } }),
    (api) => api.connect({ service: "github", place: "github.com", owner: "acme", account: { id: "acc_1" }, secret: { kind: "login", tool: "gh", login: "yuser" }, replaces: "cred_1" }),
    (api) => api.connect({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_1" }, secret: { kind: "stored" } }),
  ],
  checkAgain: [(api) => api.checkAgain({ fleet: "github.com/acme/web", role: "tracker" })],
  makeDefault: [(api) => api.makeDefault({ accountId: "acc_1" })],
  removeAssignment: [(api) => api.removeAssignment({ scope: "github.com/other-org" })],
  removeCredential: [(api) => api.removeCredential({ credentialId: "cred_1" })],
  removeAccount: [(api) => api.removeAccount({ accountId: "acc_1" })],
  setInterval: [(api) => api.setInterval({ repo: "github.com/acme/web", seconds: 45 }), (api) => api.setInterval({ repo: "github.com/acme/web", seconds: null })],
};

describe("the dashboard client against the server's contract", () => {
  it("is tried against every method the server serves", () => {
    expect(Object.keys(TYPICAL).sort()).toEqual(Object.keys(rpcContract).sort());
  });

  for (const [method, calls] of Object.entries(TYPICAL)) {
    it(`sends ${method} as the method of that name, with an input the server accepts`, async () => {
      const seen: Seen[] = [];
      const api = createDashboardApi(validatingCaller(seen));
      for (const call of calls) await call(api);
      expect(seen).toHaveLength(calls.length);
      for (const one of seen) expect({ method: one.method, issues: one.issues }).toEqual({ method, issues: [] });
    });
  }

  it("would notice an input the server refuses", async () => {
    const seen: Seen[] = [];
    const caller = validatingCaller(seen);
    await caller.call("setInterval", { repo: "github.com/acme/web", seconds: "soon" } as never);
    await caller.call("fleets", {} as never);
    expect(seen.map((one) => one.issues.length > 0)).toEqual([true, true]);
  });
});
