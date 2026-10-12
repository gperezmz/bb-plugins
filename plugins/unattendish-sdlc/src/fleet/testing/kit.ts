// A fleet's world for the use-case tests: fakes for every port, a registration
// to start from, and builders for what a source read says.
import type { RegisterDeps } from "../application/register";
import type { PollDeps } from "../application/poll";
import { repoId, parseRepo } from "../domain/identity";
import type { ActivityEvent, ItemSnapshot, ReadOutcome, ServiceKind } from "../domain/model";
import type { RegisterArgs } from "../domain/registration";
import { FakeAdapter, FakeChannel, FakeClock, FakeCost, FakeCredentialAdmin, FakeCredentials, FakeEvents, FakeHttp, FakeManifests, FakeRepositories, FakeThreads } from "./fakes";
import { InMemoryStore } from "./memory-store";

export const REPO = "github.com/org/repo";
export const REPO_KEY = repoId(parseRepo(REPO)!);
export const MANAGER = "thr_manager";
export const MANIFEST_PATH = "/work/fleet/manifest.md";
export const TOKEN = "ghp_secret_token_value_1";
export const MARKER = "🤖 unattendish agent";
export const OPERATOR = "olivia";

export const args = (over: Partial<RegisterArgs> = {}): RegisterArgs => ({
  contract: 1,
  repo: REPO,
  tracker: "forge-issues",
  manifest: MANIFEST_PATH,
  operator: OPERATOR,
  labelSpec: "spec",
  labelReady: "status:ready",
  labelInProgress: "status:in-progress",
  labelNeedsInput: "status:needs-input",
  marker: MARKER,
  echoActors: [],
  ...over,
});

export const world = () => {
  const clock = new FakeClock();
  const threads = new FakeThreads();
  threads.states.set(MANAGER, "live");
  const channel = new FakeChannel();
  const manifests = new FakeManifests();
  const credentials = new FakeCredentials([{ prefix: "github.com/org", service: "github", token: TOKEN }]);
  const http = new FakeHttp();
  const store = new InMemoryStore();
  const adapters = { github: new FakeAdapter("github"), gitlab: new FakeAdapter("gitlab"), linear: new FakeAdapter("linear"), jira: new FakeAdapter("jira") } satisfies Record<ServiceKind, FakeAdapter>;
  const warnings: string[] = [];
  const events = new FakeEvents();
  const cost = new FakeCost();
  const repositories = new FakeRepositories();
  const admin = new FakeCredentialAdmin();
  const poll: PollDeps = { store, threads, channel, credentials, http, adapters, manifests, clock, events, log: { warn: (m) => warnings.push(m) }, rateLimits: new Map() };
  const register: RegisterDeps = { store, threads, credentials, manifests, clock, events };
  return { clock, threads, channel, manifests, credentials, http, store, adapters, warnings, poll, register, events, cost, repositories, admin };
};

export type World = ReturnType<typeof world>;

/** A manifest with the rows given as already-formatted table lines. */
export const manifest = (rows: { inbox?: string[]; inFlight?: string[]; blocked?: string[]; landed?: string[] } = {}): string => {
  const table = (head: string, columns: string[], lines: string[] | undefined) =>
    lines === undefined || lines.length === 0
      ? `## ${head}\n\nNothing here.\n`
      : `## ${head}\n\n| ${columns.join(" | ")} |\n|${columns.map(() => " --- |").join("")}\n${lines.join("\n")}\n`;
  return [
    `# Fleet: ${REPO}`,
    "",
    table("Inbox", ["Ref", "What", "Waits for", "Since", "Link"], rows.inbox),
    table("In flight", ["Ref", "Work", "Stage", "Since", "Builder", "Link"], rows.inFlight),
    table("Blocked", ["Ref", "Blocked on", "Link"], rows.blocked),
    table("Landed", ["Ref", "Spec", "Merged", "Link"], rows.landed),
  ].join("\n");
};

export const issueUrl = (n: number) => `https://github.com/org/repo/issues/${n}`;
export const pullUrl = (n: number) => `https://github.com/org/repo/pull/${n}`;
export const inboxRow = (n: number, waitsFor = "answer") => `| #${n} | A parked question | ${waitsFor} | 2026-10-12T09:00:00Z | ${issueUrl(n)} |`;
export const inFlightRow = (n: number, pull: number) => `| #${n} | Build it | under review | 2026-10-12T09:00:00Z | thr_builder | ${pullUrl(pull)} |`;

export const snapshot = (n: number, over: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  role: "forge",
  ref: `#${n}`,
  url: issueUrl(n),
  open: true,
  merged: false,
  fleetLabels: [],
  checks: null,
  inPartition: false,
  transitions: [],
  ...over,
});

export const event = (id: string, n: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id,
  role: "forge",
  ref: `#${n}`,
  url: `${issueUrl(n)}#issuecomment-${id}`,
  kind: "commented",
  actor: "alice",
  at: "2026-10-12T10:00:30.000Z",
  lastLine: "An answer.",
  ...over,
});

export const outcome = (over: Partial<ReadOutcome> = {}): ReadOutcome => ({ snapshots: [], events: [], updated: [], failures: [], ...over });
