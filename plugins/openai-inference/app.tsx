// OpenAI-compatible inference's frontend entry: the Endpoints section of the plugin's page in Settings.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { EndpointsSettings, SECTION_DESCRIPTION, SECTION_TITLE } from "@/features/endpoints-settings";

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "endpoints", title: SECTION_TITLE, description: SECTION_DESCRIPTION, component: EndpointsSettings });
});
