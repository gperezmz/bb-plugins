// OpenAI-compatible inference's backend entry: registers the `gateway` and
// `local` AI services, and hands the settings to the host entry, which
// answers bb's completions.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configureContract, type EndpointSettingsByService } from "./src/contract";

const urlOrEmpty = z.union([z.literal(""), z.url({ protocol: /^https?$/ })], {
  error: "Enter an http:// or https:// URL, or leave it empty.",
});

export const SETTINGS = {
  gatewayUrl: {
    type: "string",
    label: "Gateway base URL",
    description:
      "Base URL of your LiteLLM gateway's OpenAI API, e.g. https://gateway.example.com/v1. Empty: the GATEWAY_URL variable in bb's environment.",
    experimental_schema: urlOrEmpty,
    default: "",
  },
  gatewayKey: {
    type: "string",
    label: "Gateway virtual key",
    description: "Sent as a Bearer token. Empty: the GATEWAY_VIRTUAL_KEY variable in bb's environment.",
    secret: true,
  },
  localUrl: {
    type: "string",
    label: "Local server base URL",
    description:
      "Base URL of a local OpenAI-compatible server (mlx_lm.server, LM Studio, llama.cpp), e.g. http://127.0.0.1:8080/v1.",
    experimental_schema: urlOrEmpty,
    default: "",
  },
  localKey: {
    type: "string",
    label: "Local server API key",
    description: "Sent as a Bearer token. Leave it empty when the server asks for none.",
    secret: true,
  },
} as const;

type Values = { gatewayUrl: string; gatewayKey?: string; localUrl: string; localKey?: string };

const orNull = (value: string | undefined): string | null => (value ? value : null);

export const endpointSettings = (values: Values): EndpointSettingsByService => ({
  gateway: { baseUrl: orNull(values.gatewayUrl), apiKey: orNull(values.gatewayKey) },
  local: { baseUrl: orNull(values.localUrl), apiKey: orNull(values.localKey) },
});

export default async function plugin(bb: BbPluginApi) {
  bb.experimental_aiServices.register({ id: "gateway", displayName: "LiteLLM gateway (OpenAI-compatible)", kinds: ["inference"] });
  bb.experimental_aiServices.register({ id: "local", displayName: "Local OpenAI-compatible server", kinds: ["inference"] });

  const settings = bb.settings.define(SETTINGS);
  const host = bb.hosts.experimental_client({ contract: configureContract });

  // bb calls the host entry on the primary host, so that is where the
  // settings go.
  const sendSettings = async () => {
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId === null) throw new Error("bb has no primary host to send the settings to");
    await host.call("configure", endpointSettings(await settings.get()), { hostId: primaryHostId });
  };

  settings.onChange(() => {
    sendSettings().catch((error: unknown) => bb.log.warn(`Could not send the settings to the host: ${String(error)}`));
  });
  // A service, because bb.sdk is usable only once the server listens; a
  // failed send throws, and bb restarts the service with backoff.
  bb.background.service("send-settings", {
    async start(signal) {
      await sendSettings();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
}
