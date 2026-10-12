// The composition root: names every concrete adapter, wires them to the use
// cases, and returns what the plugin's entry mounts its surfaces over.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PluginCliError } from "@get-bb/plugin-sdk";
import { CachedCost } from "./fleet/application/cost-cache";
import { createDashboard } from "./fleet/application/dashboard";
import type { PollDeps } from "./fleet/application/poll";
import { registerFleet } from "./fleet/application/register";
import { pollDue, pruneLedger, refreshFleetsOf, setFleetInterval } from "./fleet/application/schedule";
import { SerialQueue } from "./fleet/application/serial";
import { fleetStatus } from "./fleet/application/status";
import type { Clock, ServiceAdapter } from "./fleet/application/ports";
import type { DashboardApi } from "./fleet/application/views";
import { BbDashboardEvents } from "./fleet/adapters/bb-realtime";
import { BbManagerChannel, BbThreadDirectory, BbThreadRepositories } from "./fleet/adapters/bb-threads";
import type { FleetCliApp } from "./fleet/adapters/cli";
import { SettingsCredentialAdmin } from "./fleet/adapters/credential-admin";
import { execCli, SettingsCredentials, type RunCli } from "./fleet/adapters/credentials";
import { createGithubAdapter } from "./fleet/adapters/github";
import { createGitlabAdapter } from "./fleet/adapters/gitlab";
import { HttpClient } from "./fleet/adapters/http";
import { createJiraAdapter } from "./fleet/adapters/jira";
import { createLinearAdapter } from "./fleet/adapters/linear";
import { FileManifests } from "./fleet/adapters/manifest-file";
import { SETTINGS } from "./fleet/adapters/settings";
import { ThreadUsageCost } from "./fleet/adapters/thread-usage-cost";
import { MIGRATIONS, SqliteStore } from "./fleet/adapters/store";
import { parseRepo, repoId } from "./fleet/domain/identity";
import type { ServiceKind } from "./fleet/domain/model";
import { messageOf, redact } from "./fleet/domain/redact";

export interface ComposeOptions {
  readonly clock?: Clock;
  readonly fetch?: typeof fetch;
  readonly runCli?: RunCli;
}

export interface Fleets {
  readonly app: FleetCliApp;
  /** What the dashboard's pages call, which the RPC mounts. */
  readonly dashboard: DashboardApi;
  /** Starts the poll of every fleet whose interval has run out and is not being worked on; settles when those polls have. */
  pollDue(): Promise<void>;
  /** The manager's turn ended: reads the state of items the manifest now names, so changes before the next poll are changes. */
  refreshWatched(threadId: string): Promise<void>;
  /** bb dispatched a queued message; if it was a wake, records when. */
  dispatched(queuedMessageId: string): void;
  prune(): void;
  /** Logs that `what` failed with `error`, scrubbed of every configured token. */
  failed(what: string, error: unknown): void;
  /** What is wrong with the settings, for a person. */
  settingsProblems(): string[];
}

const repoOf = (text: string) => {
  const repo = parseRepo(text);
  if (repo === null) throw new PluginCliError(`"${text}" is not a repository; write it as host/owner/repo`, { code: "invalid_value" });
  return repoId(repo);
};

export async function compose(bb: BbPluginApi, options: ComposeOptions = {}): Promise<Fleets> {
  const clock: Clock = options.clock ?? { now: () => new Date() };
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new SqliteStore(db);

  const settings = bb.settings.define(SETTINGS);
  let values = await settings.get();
  const credentials = new SettingsCredentials(() => values, options.runCli ?? execCli, clock);
  settings.onChange((next) => {
    values = next;
    credentials.reload(next);
  });

  // bb.sdk can be read only once the server listens, so the adapters read it when they are called.
  const sdk = {
    get threads() { return bb.sdk.threads; },
    get projects() { return bb.sdk.projects; },
    get plugins() { return bb.sdk.plugins; },
  } as BbPluginApi["sdk"];
  const threads = new BbThreadDirectory(sdk);
  const adapters: Record<ServiceKind, ServiceAdapter> = {
    github: createGithubAdapter(),
    gitlab: createGitlabAdapter(),
    linear: createLinearAdapter(),
    jira: createJiraAdapter(),
  };
  const log = { warn: (message: string) => bb.log.warn(redact(message, credentials.secrets())) };
  const events = new BbDashboardEvents(bb.realtime, log);
  const poll: PollDeps = {
    store,
    threads,
    channel: new BbManagerChannel(sdk, bb.pluginId),
    credentials,
    http: new HttpClient(options.fetch === undefined ? {} : { fetch: options.fetch }),
    adapters,
    manifests: new FileManifests(),
    clock,
    events,
    log,
    rateLimits: new Map(),
  };
  const queue = new SerialQueue();

  // Work that changes a fleet runs behind any poll of it; a caller that cannot wait gets its answer from the registry as it stands.
  const failed = (what: string, error: unknown): void => log.warn(`${what} failed: ${messageOf(error, credentials.secrets())}`);
  const settle = (work: Promise<unknown>, what: string): void => {
    work.catch((error: unknown) => failed(what, error));
  };

  const app: FleetCliApp = {
    register(thread, args) {
      const repo = parseRepo(args.repo);
      return repo === null ? registerFleet(poll, thread, args) : queue.run(repoId(repo), () => registerFleet(poll, thread, args));
    },
    unregister(repo) {
      const key = repoOf(repo);
      const registered = store.getFleet(key) !== null;
      settle(queue.run(key, async () => store.removeFleet(key)).then(() => events.boardChanged()), `unregistering ${key}`);
      return registered;
    },
    status: () => fleetStatus(poll),
    ledger: (repo, query) => store.ledger(repoOf(repo), query),
    setInterval(repo, intervalMs) {
      const key = repoOf(repo);
      const registered = store.getFleet(key) !== null;
      settle(queue.run(key, async () => setFleetInterval(poll, key, intervalMs)).then(() => events.boardChanged()), `setting the interval of ${key}`);
      return registered;
    },
  };

  const dashboard = createDashboard({
    store,
    threads,
    credentials,
    manifests: poll.manifests,
    cost: new CachedCost(new ThreadUsageCost(sdk), clock),
    clock,
    channel: poll.channel,
    events,
    repositories: new BbThreadRepositories(sdk),
    admin: new SettingsCredentialAdmin(settings, () => credentials.secrets()),
    queue,
    log,
    secrets: () => credentials.secrets(),
  });

  return {
    app,
    dashboard,
    pollDue: () => pollDue(poll, queue),
    refreshWatched: (threadId) => refreshFleetsOf(poll, queue, threadId),
    dispatched: (queuedMessageId) => store.markDispatched(queuedMessageId, clock.now().toISOString()),
    prune: () => pruneLedger(poll),
    failed,
    settingsProblems: () => credentials.problems(),
  };
}
