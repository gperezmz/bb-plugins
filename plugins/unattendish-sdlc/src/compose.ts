// The composition root: names every concrete adapter, wires them to the use
// cases, and returns what the plugin's entry mounts its surfaces over.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PluginCliError } from "@get-bb/plugin-sdk";
import type { PollDeps } from "./fleet/application/poll";
import { pollFleet } from "./fleet/application/poll";
import { registerFleet } from "./fleet/application/register";
import { pollDue, pruneLedger } from "./fleet/application/schedule";
import { SerialQueue } from "./fleet/application/serial";
import { fleetStatus } from "./fleet/application/status";
import type { Clock, ServiceAdapter } from "./fleet/application/ports";
import { BbManagerChannel, BbThreadDirectory } from "./fleet/adapters/bb-threads";
import type { FleetCliApp } from "./fleet/adapters/cli";
import { execCli, SettingsCredentials, type RunCli } from "./fleet/adapters/credentials";
import { createGithubAdapter } from "./fleet/adapters/github";
import { createGitlabAdapter } from "./fleet/adapters/gitlab";
import { HttpClient } from "./fleet/adapters/http";
import { createJiraAdapter } from "./fleet/adapters/jira";
import { createLinearAdapter } from "./fleet/adapters/linear";
import { FileManifests } from "./fleet/adapters/manifest-file";
import { SETTINGS } from "./fleet/adapters/settings";
import { MIGRATIONS, SqliteStore } from "./fleet/adapters/store";
import { parseRepo, repoId } from "./fleet/domain/identity";
import type { ServiceKind } from "./fleet/domain/model";
import { redact } from "./fleet/domain/redact";

export interface ComposeOptions {
  readonly clock?: Clock;
  readonly fetch?: typeof fetch;
  readonly runCli?: RunCli;
}

export interface Fleets {
  readonly app: FleetCliApp;
  /** Polls every fleet whose interval has run out. */
  pollDue(): Promise<void>;
  /** The manager's turn ended: reads the state of items the manifest now names, so changes before the next poll are changes. */
  refreshWatched(threadId: string): Promise<void>;
  /** bb dispatched a queued message; if it was a wake, records when. */
  dispatched(queuedMessageId: string): void;
  prune(): void;
  /** Logs a warning with every configured token scrubbed from it. */
  warn(message: string): void;
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
  const sdk = { get threads() { return bb.sdk.threads; } } as BbPluginApi["sdk"];
  const threads = new BbThreadDirectory(sdk);
  const adapters: Record<ServiceKind, ServiceAdapter> = {
    github: createGithubAdapter(),
    gitlab: createGitlabAdapter(),
    linear: createLinearAdapter(),
    jira: createJiraAdapter(),
  };
  const log = { warn: (message: string) => bb.log.warn(redact(message, credentials.secrets())) };
  const poll: PollDeps = {
    store,
    threads,
    channel: new BbManagerChannel(sdk, bb.pluginId),
    credentials,
    http: new HttpClient(options.fetch === undefined ? {} : { fetch: options.fetch }),
    adapters,
    manifests: new FileManifests(),
    clock,
    log,
  };
  const queue = new SerialQueue();

  const app: FleetCliApp = {
    register: (thread, args) => registerFleet(poll, thread, args),
    unregister: (repo) => store.removeFleet(repoOf(repo)),
    status: () => fleetStatus(poll),
    ledger: (repo, query) => store.ledger(repoOf(repo), query),
    setInterval(repo, intervalMs) {
      const key = repoOf(repo);
      if (store.getFleet(key) === null) return false;
      store.setIntervalMs(key, intervalMs);
      return true;
    },
  };

  return {
    app,
    pollDue: () => pollDue(poll, queue),
    async refreshWatched(threadId) {
      const held = store.listFleets().filter((fleet) => fleet.registration.managerThreadId === threadId);
      await Promise.all(
        held.map((fleet) => {
          const key = repoId(fleet.registration.repo);
          return queue.run(key, () => pollFleet(poll, key, { stateOnly: true })).catch((error: unknown) => log.warn(`reading ${key} after a turn failed: ${error instanceof Error ? error.message : String(error)}`));
        }),
      );
    },
    dispatched: (queuedMessageId) => store.markDispatched(queuedMessageId, clock.now().toISOString()),
    prune: () => pruneLedger(poll),
    warn: log.warn,
    settingsProblems: () => credentials.problems(),
  };
}
