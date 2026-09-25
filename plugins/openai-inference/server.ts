// OpenAI-compatible inference's backend entry: hands the endpoints to the
// host entry, which answers bb's completions, and registers as an AI service
// each endpoint whose variables the host entry has.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { configureContract } from "./src/contract";
import { endpointsText, keysText, resolveEndpoints, type Endpoint } from "./src/endpoints";

export const SETTINGS = {
  endpoints: {
    type: "string",
    label: "Endpoints",
    description:
      'JSON list of OpenAI-compatible servers, e.g. [{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}, {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}]. Each id becomes an AI service: BB_INFERENCE=<id>/<model>. url and key may reference bb\'s environment as ${NAME}; key takes only a reference. An endpoint whose variables are unset is not registered. A change to this list applies on save; after changing a referenced variable, run bb plugin reload openai-inference.',
    experimental_multiline: true,
    experimental_schema: endpointsText,
    default: "[]",
  },
  keys: {
    type: "string",
    label: "Endpoint keys",
    description:
      'JSON object from endpoint id to the literal key sent to it as a Bearer token, e.g. {"mlx": "sk-..."}. It wins over the endpoint\'s own key reference.',
    secret: true,
    experimental_schema: keysText,
  },
} as const;

const displayName = (endpoint: Endpoint) => `OpenAI-compatible endpoint at ${endpoint.url}`;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define(SETTINGS);
  const host = bb.hosts.experimental_client({ contract: configureContract });
  const services = new Map<string, { displayName: string; dispose(): void }>();
  let endpoints: Endpoint[] = [];

  // bb registers a service at once when the plugin is already running, so a
  // saved change needs no reload.
  const registerServices = (available: Endpoint[]) => {
    for (const [id, service] of services) {
      if (!available.some((e) => e.id === id && displayName(e) === service.displayName)) {
        service.dispose();
        services.delete(id);
      }
    }
    for (const endpoint of available) {
      if (services.has(endpoint.id)) continue;
      try {
        const name = displayName(endpoint);
        const { dispose } = bb.experimental_aiServices.register({ id: endpoint.id, displayName: name, kinds: ["inference"] });
        services.set(endpoint.id, { displayName: name, dispose });
      } catch (error) {
        bb.log.warn(`Endpoint "${endpoint.id}" is not a service: ${String(error)}`);
      }
    }
  };

  // bb calls the host entry on the primary host, so the endpoints go there,
  // and whether their variables are set is decided there.
  const sendEndpoints = async () => {
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId === null) throw new Error("bb has no primary host to send the endpoints to");
    const report = await host.call("configure", endpoints, { hostId: primaryHostId });
    const missing = new Map(report.filter((r) => r.missing.length > 0).map((r) => [r.id, r.missing]));
    for (const [id, names] of missing) {
      bb.log.warn(`Endpoint "${id}" is not registered: not set in bb's environment: ${names.join(", ")}`);
    }
    registerServices(endpoints.filter((e) => !missing.has(e.id)));
  };

  endpoints = resolveEndpoints(await settings.get());
  settings.onChange((next) => {
    endpoints = resolveEndpoints(next);
    sendEndpoints().catch((error: unknown) => bb.log.warn(`Could not send the endpoints to the host: ${String(error)}`));
  });
  // A service, because bb.sdk is usable only once the server listens; a
  // failed send throws, and bb restarts the service with backoff.
  bb.background.service("send-endpoints", {
    async start(signal) {
      await sendEndpoints();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
}
