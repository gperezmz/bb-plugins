// Thread Usage frontend entry. Views live in src/ui; this file registers
// them with bb's slots. Every opener passes `params.threadId`, so a chip in
// one split pane opens the Usage tab for that pane's thread.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { HeaderChip } from "./src/ui/HeaderChip";
import { SettingsPanel } from "./src/ui/SettingsPanel";
import { UsagePage } from "./src/ui/UsagePage";
import { UsageTab } from "./src/ui/UsagePanel";
import { USAGE_ACTION_ID } from "./src/ui/common";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: USAGE_ACTION_ID,
    title: "Usage",
    layout: "flush",
    component: UsageTab,
    run: ({ threadId, openPanel }) => {
      openPanel({ title: "Usage", params: { threadId } });
    },
  });

  app.slots.experimental_threadHeaderAction({
    id: "usage-chip",
    title: "Thread usage",
    component: HeaderChip,
  });

  app.commands.register({
    id: "open-usage",
    title: "Show usage for this thread",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId, openPanel }) => {
      if (threadId === null) return;
      openPanel({ actionId: USAGE_ACTION_ID, title: "Usage", params: { threadId } });
    },
  });

  app.slots.navPanel({
    id: "usage",
    // "Usage" alone collides with the fleet-wide usage plugin's page.
    title: "Thread usage",
    icon: "thread-usage/coin",
    path: "usage",
    component: UsagePage,
  });

  app.slots.settingsSection({
    id: "gateway",
    title: "Gateway, history and export",
    description: "Test the gateway connection, set up Codex and pi, follow the history backfill, and export everything.",
    component: SettingsPanel,
  });
});
