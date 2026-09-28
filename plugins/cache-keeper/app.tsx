// Cache Keeper's frontend entry: the composer chip and banner on thread
// composers, the sidebar glyph, the nav page and the sections of its
// settings page, in the order bb shows them.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  AgentTools,
  AGENT_TOOLS_DESCRIPTION,
  AGENT_TOOLS_TITLE,
  Banner,
  Chip,
  mountRowStatus,
  Page,
  Prices,
  PRICES_DESCRIPTION,
  PRICES_TITLE,
  StalledTasks,
  STALLED_TASKS_DESCRIPTION,
  STALLED_TASKS_TITLE,
  TIMER_ICON,
  WaitingThreads,
  WAITING_THREADS_DESCRIPTION,
  WAITING_THREADS_TITLE,
} from "@/features/cache-keeper";

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

  app.slots.settingsSection({ id: "waiting-threads", title: WAITING_THREADS_TITLE, description: WAITING_THREADS_DESCRIPTION, component: WaitingThreads });
  app.slots.settingsSection({ id: "stalled-tasks", title: STALLED_TASKS_TITLE, description: STALLED_TASKS_DESCRIPTION, component: StalledTasks });
  app.slots.settingsSection({ id: "prices", title: PRICES_TITLE, description: PRICES_DESCRIPTION, component: Prices });
  app.slots.settingsSection({
    id: "agent-tools",
    title: AGENT_TOOLS_TITLE,
    description: AGENT_TOOLS_DESCRIPTION,
    component: AgentTools,
  });
});
