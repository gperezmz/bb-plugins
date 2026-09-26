// OpenAI-compatible inference's backend entry: registers each Endpoint as an
// AI service, and hands every AI task sent to one to the host entry on the
// primary host, which sends it on.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { contract } from "./src/contract";
import { endpointStatus, endpointsText, keysText, resolveEndpoints, type Endpoint } from "./src/endpoints";

export const SETTINGS = {
  endpoints: {
    type: "string",
    label: "Endpoints",
    description:
      'JSON list of Endpoints, each an OpenAI-compatible server and the model it answers with, e.g. [{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"}, {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}]. Each Endpoint is an AI service: select it for an AI task with bb settings ai-services set thread-title <id> (or commit-message). url and key may reference bb\'s environment as ${NAME}; key takes only a reference. A change to this list applies on save; after changing a referenced variable, run bb plugin reload openai-inference.',
    experimental_multiline: true,
    experimental_schema: endpointsText,
    default: "[]",
  },
  keys: {
    type: "string",
    label: "Endpoint keys",
    description:
      'JSON object from Endpoint id to the literal key sent to it as a Bearer token, e.g. {"mlx": "sk-..."}. It wins over the Endpoint\'s own key reference.',
    secret: true,
    experimental_schema: keysText,
  },
} as const;

// bb refuses a display name longer than 64 characters, which a long URL is.
const MAX_DISPLAY_NAME = 64;
export const displayName = (endpoint: Endpoint): string => {
  const name = `OpenAI-compatible endpoint at ${endpoint.url}`;
  return name.length <= MAX_DISPLAY_NAME ? name : `${name.slice(0, MAX_DISPLAY_NAME - 1)}…`;
};

/** The variables each Endpoint lacks on the primary host, by id. */
type Missing = Map<string, string[]>;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(SETTINGS);
  const host = bb.hosts.experimental_client({ contract });
  const services = new Map<string, { displayName: string; dispose(): void }>();
  let endpoints = resolveEndpoints(await settings.get());

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
    if (found === undefined) throw new Error(`No Endpoint "${id}" in the plugin's settings`);
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
    for (const { id, ...rest } of endpoints) {
      if (services.has(id)) continue;
      const name = displayName({ id, ...rest });
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

  registerServices();
  settings.onChange((next) => {
    endpoints = resolveEndpoints(next);
    registerServices();
    report = undefined;
    // Sent now rather than at the next status read, so the host entry
    // forgets what URLs no longer listed refused.
    void started.then(() => void sendEndpoints());
  });
  // A service, because bb.sdk is usable only once the server listens; a
  // failed send throws, and bb restarts the service with backoff.
  bb.background.service("send-endpoints", {
    async start(signal) {
      markStarted();
      await sendEndpoints();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
}
