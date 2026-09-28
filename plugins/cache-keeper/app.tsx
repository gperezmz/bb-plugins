// Cache Keeper's frontend entry: the composer chip and banner on thread
// composers, the sidebar glyph, the nav page and the Agent tools section of
// its settings.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AgentTools, AGENT_TOOLS_DESCRIPTION, AGENT_TOOLS_TITLE, Banner, Chip, TIMER_ICON, mountRowStatus, Page } from "@/features/cache-keeper";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "cache-keeper",
    scopes: ["thread"],
    actions: [{ id: "chip", component: Chip }],
    banners: [{ id: "banner", chrome: "card", component: Banner }],
  });

  app.contentScripts.register({ id: "row-status", mount: mountRowStatus });

  app.slots.navPanel({
    id: "cache-keeper",
    title: "Cache Keeper",
    icon: TIMER_ICON,
    path: "cache-keeper",
    component: Page,
  });

  app.slots.settingsSection({
    id: "agent-tools",
    title: AGENT_TOOLS_TITLE,
    description: AGENT_TOOLS_DESCRIPTION,
    component: AgentTools,
  });
});
