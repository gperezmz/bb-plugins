// The model a thread runs on and its reasoning level, as bb reports them,
// which the Hover card shows. Asked of bb once per thread and status: a
// finished turn can change what the next message uses.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { modelDisplayName } from "../model/harness";

export interface ModelAnswer {
  /** The catalog's display name, else the model's id; null when bb has none for the thread. */
  model: string | null;
  reasoningLevel: string | null;
}

const answers = new Map<string, Promise<ModelAnswer>>();
const catalogs = new Map<string, Promise<readonly { id: string; model: string; displayName: string }[]>>();

export function lookUpModel(sdk: PluginBrowserBbSdk, thread: { id: string; providerId: string; status: string; host: { id: string } | null }): Promise<ModelAnswer> {
  const key = `${thread.id}:${thread.status}`;
  let pending = answers.get(key);
  if (pending === undefined) {
    const catalogKey = `${thread.providerId}:${thread.host?.id ?? ""}`;
    let catalog = catalogs.get(catalogKey);
    if (catalog === undefined) {
      const args = thread.host ? { providerId: thread.providerId, hostId: thread.host.id } : { providerId: thread.providerId };
      // Called inside the chain, so a call that throws leaves the catalog empty and the id stands for the name.
      catalog = Promise.resolve()
        .then(() => sdk.providers.models(args))
        .then(
          (result) => result.models,
          () => [],
        );
      catalogs.set(catalogKey, catalog);
    }
    const names = catalog;
    pending = Promise.resolve()
      .then(() => sdk.threads.defaultExecutionOptions({ threadId: thread.id }))
      .then(async (options) =>
        options === null ? { model: null, reasoningLevel: null } : { model: modelDisplayName(options.model, await names), reasoningLevel: options.reasoningLevel },
      );
    // A failed lookup is asked again the next time a card opens.
    pending.catch(() => answers.delete(key));
    answers.set(key, pending);
  }
  return pending;
}

/** Forgets every answer, as a reload of the app does. For tests. */
export function forgetModelLookups(): void {
  answers.clear();
  catalogs.clear();
}
