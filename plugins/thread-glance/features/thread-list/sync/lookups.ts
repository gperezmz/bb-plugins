// What the list asks bb, asked once for the plugin's lifetime rather than
// once per mount: bb's system facts, each project's default branch, and the
// model a thread runs, which its details and hover card show.
//
// Debt: the answers are kept with no refresh, because the SDK offers no
// cached query for them. It clears when the SDK does, or when a default
// branch or system setting changing mid-session matters.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { modelDisplayName } from "../model/details";
import { defaultSourceHostId } from "../model/branches";
import type { SystemFacts } from "../store/api";
import { pluginData } from "./plugin-data";

interface SystemConfig {
  primaryHostId: string | null;
  generalSettings: { defaultProviderId: string | null };
}

/**
 * The facts in `system.config()`'s answer, with `providers`, bb's harnesses
 * in its order as `providers.list()` gives them, or null when that is not
 * known. The default harness is the one bb starts a new thread on: the one
 * the user chose in bb's settings while it is available, else the first
 * available one. Without `providers` it is the chosen one, or unknown.
 * `serverAccess.defaultProviderId` is how machines reach the server, not a
 * harness, so it plays no part.
 */
export function readSystemFacts(
  config: SystemConfig,
  providers: readonly { id: string; available: boolean }[] | null = null,
): SystemFacts {
  const chosen = config.generalSettings.defaultProviderId;
  let defaultProviderId = chosen;
  if (providers !== null) {
    const available = providers.filter((provider) => provider.available).map((provider) => provider.id);
    defaultProviderId = chosen !== null && available.includes(chosen) ? chosen : (available[0] ?? null);
  }
  return { defaultProviderId, primaryHostId: config.primaryHostId };
}

export interface ModelInfo {
  /** The catalog's display name ("Haiku 4.5"), or the raw id when unknown. */
  model: string;
  reasoningLevel: string;
}

let systemAsked = false;
const branchesAsked = new Set<string>();
const models = new Map<string, Promise<ModelInfo | null>>();
const catalogs = new Map<string, Promise<readonly { id: string; model: string; displayName: string }[]>>();

/** Asks bb's system facts, once. */
export function lookUpSystem(sdk: PluginBrowserBbSdk): void {
  if (systemAsked) return;
  systemAsked = true;
  // Called inside the chain, so a host that throws for an area it lacks
  // lands in the rejection handler and leaves the facts unknown.
  const providers = Promise.resolve()
    .then(() => sdk.providers.list())
    .catch(() => null);
  Promise.resolve()
    .then(() => sdk.system.config())
    .then(
      async (config) => pluginData.facts({ system: readSystemFacts(config, await providers) }),
      () => {
        // Unknown is not an answer: the next list mounted asks again.
        systemAsked = false;
      },
    );
}

/** Looks up the default branch of each project in `projectIds` not asked about yet, through its default source's machine. */
export function lookUpDefaultBranches(sdk: PluginBrowserBbSdk, projectIds: readonly string[]): void {
  for (const projectId of projectIds) {
    if (branchesAsked.has(projectId)) continue;
    branchesAsked.add(projectId);
    const settle = (branch: string | null) =>
      pluginData.facts({ defaultBranches: new Map(pluginData.get().defaultBranches).set(projectId, branch) });
    sdk.projects
      .get({ projectId })
      .then(async (project) => {
        const hostId = defaultSourceHostId(project.sources);
        if (hostId === null) return null;
        const result = await sdk.projects.branches({ projectId, hostId, limit: "1" });
        return result.defaultBranch ?? null;
      })
      .then(settle, () => {
        // Drawn as no branch for now, and asked again by the next list mounted.
        branchesAsked.delete(projectId);
        settle(null);
      });
  }
}

/** The model a thread runs, and its reasoning level, asked once per thread and status. */
export function lookUpModel(
  sdk: PluginBrowserBbSdk,
  thread: { id: string; providerId: string; host: { id: string } | null } | undefined,
  threadId: string,
  status: string,
): Promise<ModelInfo | null> {
  const key = `${threadId}:${status}`;
  let pending = models.get(key);
  if (pending === undefined) {
    const providerId = thread?.providerId ?? "";
    // The catalog names the model as the composer does ("Haiku 4.5").
    let catalog = catalogs.get(providerId);
    if (catalog === undefined) {
      catalog = sdk.providers
        .models(thread?.host ? { providerId, hostId: thread.host.id } : { providerId })
        .then(
          (result) => result.models,
          () => [],
        );
      catalogs.set(providerId, catalog);
    }
    const names = catalog;
    pending = sdk.threads.defaultExecutionOptions({ threadId }).then(
      async (options) =>
        options === null ? null : { model: modelDisplayName(options.model, await names), reasoningLevel: options.reasoningLevel },
      () => {
        // A failed lookup is asked again the next time the thread's details show.
        models.delete(key);
        return null;
      },
    );
    models.set(key, pending);
  }
  return pending;
}

/** Forgets every answer, as a reload of the app does. For tests. */
export function forgetLookups(): void {
  systemAsked = false;
  branchesAsked.clear();
  models.clear();
  catalogs.clear();
}
