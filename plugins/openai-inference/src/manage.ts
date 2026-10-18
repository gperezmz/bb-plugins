/**
 * What the page and the command do to the Endpoints: save one, remove one,
 * copy those 0.3 saved. Each runs alone, reads the saved Endpoints, applies
 * `rules.ts`'s plan to the key file and then to the stored list, and tells
 * `changed` the list now in effect. Names no framework: the store and the key
 * file are ports.
 */
import type { Endpoint } from "./endpoints.js";
import type { Legacy } from "./legacy.js";
import { planSave, type Draft, type FieldErrors, type KeyDraft } from "./rules.js";

/** Where the Endpoints are kept; never holds a literal key. */
export interface EndpointStore {
  read(): Promise<Endpoint[]>;
  write(endpoints: readonly Endpoint[]): Promise<void>;
}

/** Where literal keys are kept, by Endpoint id. */
export interface KeyVault {
  put(id: string, key: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SaveResult =
  | { ok: true; endpoints: Endpoint[] }
  | { ok: false; fields: FieldErrors }
  /** Refused, but not for a field: the whole reason. */
  | { ok: false; problem: string };

/** What the plugin's command sets: the key is a `${NAME}` reference or absent, never a literal key. */
export interface CommandSet {
  id: string;
  url: string;
  model: string;
  /** The `${NAME}` reference to set; null leaves a saved Endpoint's key as it is. */
  key: string | null;
}

export interface EndpointManager {
  list(): Promise<Endpoint[]>;
  /** Saves `draft` as a new Endpoint (`create`) or over the saved one with its id. */
  save(draft: Draft, create: boolean): Promise<SaveResult>;
  /** Saves what the command sets, as `save` would, but never changes or clears a literal key. */
  set(input: CommandSet): Promise<SaveResult>;
  remove(id: string): Promise<SaveResult>;
  /** Adds the Endpoints and literal keys 0.3 saved, except for ids already here; returns the ids added. */
  adopt(items: readonly Legacy[]): Promise<string[]>;
}

export function createEndpointManager(options: {
  store: EndpointStore;
  vault: KeyVault;
  /** Called with the list once it is stored. */
  changed: (endpoints: readonly Endpoint[]) => void | Promise<void>;
}): EndpointManager {
  const { store, vault, changed } = options;

  // Every operation reads then writes the list, so they run one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const alone = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  const replace = (list: readonly Endpoint[], endpoint: Endpoint): Endpoint[] =>
    list.some((e) => e.id === endpoint.id) ? list.map((e) => (e.id === endpoint.id ? endpoint : e)) : [...list, endpoint];

  const saveNow = async (draft: Draft, create: boolean): Promise<SaveResult> => {
    const saved = await store.read();
    const plan = planSave(draft, saved, create);
    if (!plan.ok) return plan;
    const { endpoint, vault: action } = plan;
    if (action.do === "put") await vault.put(endpoint.id, action.key);
    else if (action.do === "remove") await vault.remove(endpoint.id);
    const next = replace(saved, endpoint);
    try {
      await store.write(next);
    } catch (error) {
      // A key put for an Endpoint that was not saved would stay behind.
      if (action.do === "put" && !saved.some((e) => e.id === endpoint.id)) await vault.remove(endpoint.id).catch(() => undefined);
      throw error;
    }
    await changed(next);
    return { ok: true, endpoints: next };
  };

  return {
    list: () => store.read(),
    save: (draft, create) => alone(() => saveNow(draft, create)),
    set: (input) =>
      alone(async () => {
        const saved = await store.read();
        const existing = saved.find((e) => e.id === input.id);
        const url = input.url.trim();
        let key: KeyDraft;
        if (input.key !== null) key = { kind: "variable", reference: input.key };
        else if (existing === undefined) key = { kind: "none" };
        else if (existing.key.kind === "literal") {
          if (existing.key.set && existing.url !== url) {
            return { ok: false, problem: `"${input.id}" has a literal key, which a new URL clears: change its URL on the plugin's page, where the key is typed again.` } as const;
          }
          key = { kind: "literal", value: null };
        } else key = existing.key;
        return saveNow({ id: input.id, url: input.url, model: input.model, key }, existing === undefined);
      }),
    remove: (id) =>
      alone(async () => {
        const saved = await store.read();
        const existing = saved.find((e) => e.id === id);
        if (existing === undefined) return { ok: false, problem: `There is no Endpoint "${id}" to remove.` };
        if (existing.key.kind === "literal") await vault.remove(id);
        const next = saved.filter((e) => e.id !== id);
        await store.write(next);
        await changed(next);
        return { ok: true, endpoints: next };
      }),
    adopt: (items) =>
      alone(async () => {
        const saved = await store.read();
        const fresh = items.filter((item) => !saved.some((e) => e.id === item.endpoint.id));
        // Keys first: a key whose Endpoint was not stored is put again by the next attempt.
        for (const { endpoint, literalKey } of fresh) if (literalKey !== null) await vault.put(endpoint.id, literalKey);
        if (fresh.length > 0) {
          const next = [...saved, ...fresh.map((item) => item.endpoint)];
          await store.write(next);
          await changed(next);
        }
        return fresh.map((item) => item.endpoint.id);
      }),
  };
}
