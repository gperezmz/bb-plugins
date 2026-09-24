/**
 * The host method the server calls (`bb.hosts.experimental_client`):
 * `configure` carries the settings to the host entry, where the plugin's
 * settings cannot be read. The host entry adds bb's AI-service methods in
 * `host-contract.ts`; bb's server runtime has no `@get-bb/plugin-sdk/ai-services`
 * module, so this file must not import it.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The `<serviceId>` a user puts in `BB_INFERENCE=<serviceId>/<model>`. */
export const SERVICE_IDS = ["gateway", "local"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const isServiceId = (id: string): id is ServiceId => (SERVICE_IDS as readonly string[]).includes(id);

/** What the settings say about one service; null leaves the default in place. */
const endpointSettingsSchema = z
  .object({
    baseUrl: z.string().nullable(),
    apiKey: z.string().nullable(),
  })
  .strict();

export const endpointSettingsByServiceSchema = z
  .object({
    gateway: endpointSettingsSchema,
    local: endpointSettingsSchema,
  })
  .strict();
export type EndpointSettingsByService = z.infer<typeof endpointSettingsByServiceSchema>;

export const configureContract = defineRpcContract({
  configure: { input: endpointSettingsByServiceSchema, output: z.null() },
});
