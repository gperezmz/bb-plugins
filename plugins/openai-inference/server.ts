// OpenAI-compatible inference's backend entry: registers each Endpoint as an
// AI service, hands every AI task sent to one to the host entry on the primary
// host, which sends it on, and serves the page, the command and the one-time
// copy of what 0.3 saved in its settings.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createCli } from "./src/cli";
import { contract } from "./src/contract";
import { endpointListSchema, endpointStatus, type Endpoint } from "./src/endpoints";
import { readLegacy } from "./src/legacy";
import { createEndpointManager, type EndpointManager } from "./src/manage";
import { pageContract } from "./src/page-contract";
import { registerPageRpc } from "./src/page-rpc";

export { pageContract };

/** Where the Endpoints are kept, in the plugin's storage: JSON, never a literal key. */
const ENDPOINTS_KEY = "endpoints";
/** Set once 0.3's settings are copied; from then on the plugin declares no setting. */
const COPIED_KEY = "legacy-settings-copied";

/**
 * 0.3's settings, declared only until their values are copied (bb 0.46 lets a
 * plugin read a setting only by declaring it).
 */
const LEGACY_SETTINGS = {
  endpoints: {
    type: "string",
    label: "Endpoints (old setting)",
    description:
      "Saved by 0.3 and copied once into the Endpoints section of this page, then no longer shown. Fix a value that could not be read here and save; it is copied again.",
    experimental_multiline: true,
    default: "[]",
  },
  keys: {
    type: "string",
    label: "Endpoint keys (old setting)",
    description: "Saved by 0.3, copied once into the Endpoints section as literal keys and then removed.",
    secret: true,
  },
} as const;

// bb refuses a display name longer than 64 characters, which a long URL is.
const MAX_DISPLAY_NAME = 64;
export const displayName = (endpoint: Endpoint): string => {
  const name = `OpenAI-compatible endpoint at ${endpoint.url}`;
  return name.length <= MAX_DISPLAY_NAME ? name : `${name.slice(0, MAX_DISPLAY_NAME - 1)}…`;
};

/** How long a failed copy waits before it tries again. */
const COPY_RETRY_MS = 30_000;

/** The variables each Endpoint lacks on the primary host, by id. */
type Missing = Map<string, string[]>;

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract });
  const services = new Map<string, { displayName: string; dispose(): void }>();

  const copied = (await bb.storage.kv.get<boolean>(COPIED_KEY)) === true;
  const legacy = copied ? undefined : bb.settings.define(LEGACY_SETTINGS);

  const store = {
    async read(): Promise<Endpoint[]> {
      return endpointListSchema.parse((await bb.storage.kv.get<unknown>(ENDPOINTS_KEY)) ?? []);
    },
    async write(list: readonly Endpoint[]): Promise<void> {
      await bb.storage.kv.set(ENDPOINTS_KEY, list);
    },
  };
  let endpoints: Endpoint[] = [];
  try {
    endpoints = await store.read();
  } catch (error) {
    bb.log.error(`The saved Endpoints could not be read: ${String(error)}`);
  }

  const primaryHostId = async (): Promise<string> => {
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId === null) throw new Error("No primary machine is connected");
    return primaryHostId;
  };

  // Whether an Endpoint's variables are set is decided on the primary host,
  // whose environment the host entry has. `report` is what it answered for
  // the Endpoints last sent, and is sent again when that failed or the
  // Endpoints changed. bb.sdk is usable only once the service starts.
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  let report: Promise<Missing> | undefined;
  const sendEndpoints = (): Promise<Missing> => {
    const sent = (async () => {
      const answer = await host.call("configure", endpoints, { hostId: await primaryHostId() });
      return new Map(answer.map((r) => [r.id, r.missing]));
    })();
    // A failed send is reported by the status that reads it.
    sent.catch(() => undefined);
    report = sent;
    return sent;
  };
  const missing = async (): Promise<Missing> => {
    await started;
    return (report ?? sendEndpoints()).catch(() => sendEndpoints());
  };

  const endpoint = (id: string): Endpoint => {
    const found = endpoints.find((e) => e.id === id);
    if (found === undefined) throw new Error(`No Endpoint "${id}" in the plugin's Endpoints`);
    return found;
  };

  // bb registers a service at once when the plugin is already running, so a
  // saved change needs no reload.
  const registerServices = () => {
    for (const [id, service] of services) {
      if (!endpoints.some((e) => e.id === id && displayName(e) === service.displayName)) {
        service.dispose();
        services.delete(id);
      }
    }
    for (const found of endpoints) {
      const { id } = found;
      if (services.has(id)) continue;
      const name = displayName(found);
      try {
        const { dispose } = bb.experimental_aiServices.register({
          id,
          displayName: name,
          // Reads configuration only: bb calls it before every AI task.
          status: async () => endpointStatus(endpoint(id), (await missing()).get(id) ?? []),
          complete: async (prompt, { signal }) => {
            const result = await host.call("complete", { endpoint: endpoint(id), prompt }, { hostId: await primaryHostId(), signal });
            if (!result.ok) throw new Error(result.message);
            return result.text;
          },
        });
        services.set(id, { displayName: name, dispose });
      } catch (error) {
        bb.log.warn(`Endpoint "${id}" is not a service: ${String(error)}`);
      }
    }
  };

  const manager: EndpointManager = createEndpointManager({
    store,
    vault: {
      put: async (id, key) => void (await host.call("putKey", { id, key }, { hostId: await primaryHostId() })),
      remove: async (id) => void (await host.call("removeKey", { id }, { hostId: await primaryHostId() })),
    },
    changed: (next) => {
      endpoints = [...next];
      registerServices();
      report = undefined;
      // Sent now rather than at the next status read, so the host entry
      // forgets what URLs no longer listed refused.
      void started.then(() => void sendEndpoints());
    },
  });

  // What the page says about the old settings, while they are still declared.
  let notice: string | null = null;
  registerServices();
  registerPageRpc(bb, manager, () => notice);
  bb.cli.register(createCli(manager));

  // A service, because bb.sdk is usable only once the server listens; a
  // failed send throws, and bb restarts the service with backoff.
  bb.background.service("send-endpoints", {
    async start(signal) {
      markStarted();
      await sendEndpoints();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });

  if (legacy !== undefined) {
    let wake: () => void = () => undefined;
    legacy.onChange(() => wake());
    bb.background.service("copy-legacy-settings", {
      async start(signal) {
        const wait = (ms: number | null) =>
          new Promise<void>((resolve) => {
            const done = () => {
              if (timer !== undefined) clearTimeout(timer);
              signal.removeEventListener("abort", done);
              wake = () => undefined;
              resolve();
            };
            const timer = ms === null ? undefined : setTimeout(done, ms);
            wake = done;
            signal.addEventListener("abort", done, { once: true });
          });
        while (!signal.aborted) {
          const values = await legacy.get();
          const read = readLegacy(values.endpoints, values.keys);
          if (!read.ok) {
            notice = `${read.reason} Nothing was copied: fix it in the old setting above and save.`;
            await wait(null);
            continue;
          }
          try {
            const added = await manager.adopt(read.items);
            await legacy.experimental_set({ keys: null });
            await bb.storage.kv.set(COPIED_KEY, true);
            notice = null;
            bb.log.info(`Copied ${added.length} Endpoint(s) from the old settings.`);
          } catch (error) {
            notice = `The Endpoints saved in the old settings are not copied yet: ${error instanceof Error ? error.message : String(error)}. The plugin tries again.`;
            bb.log.warn(notice);
            await wait(COPY_RETRY_MS);
            continue;
          }
          // The next load declares no setting, so bb stops drawing the old fields.
          try {
            await bb.sdk.plugins.reload({ pluginId: bb.pluginId });
          } catch (error) {
            bb.log.warn(`The old settings are copied; reload the plugin to stop showing them: ${String(error)}`);
          }
          await wait(null);
        }
      },
    });
  }
}
