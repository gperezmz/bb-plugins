// Unattendish frontend entry: registers the plugin's pages with bb's slots.
//   the Fleets page, with its count in the page header;
//   the Fleet chip in a manager thread's header, and the Fleet tab it opens;
//   the overlay that toasts a new Inbox row;
//   the settings section for credentials and poll intervals.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CredentialsSettings } from "@/features/credentials-settings";
import { FleetChip } from "@/features/fleet-chip";
import { FleetTab } from "@/features/fleet-tab";
import { FleetsHeaderCount, FleetsPage } from "@/features/fleets-page";
import { InboxToasts } from "@/features/inbox-toasts";
import { FLEET_TAB_ACTION_ID } from "@/shared/open-fleet-tab";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "fleets",
    title: "Fleets",
    // The plugin's own glyph, declared under bb.branding.experimental_icons.
    icon: "unattendish-sdlc/fleet",
    path: "fleets",
    component: FleetsPage,
    headerContent: FleetsHeaderCount,
  });

  app.slots.threadPanelAction({
    id: FLEET_TAB_ACTION_ID,
    title: "Fleet",
    icon: "unattendish-sdlc/fleet",
    component: FleetTab,
    run: ({ threadId, openPanel }) => {
      openPanel({ title: "Fleet", params: { threadId } });
    },
  });

  app.slots.experimental_threadHeaderAction({ id: "fleet-chip", title: "Fleet", component: FleetChip });

  app.slots.settingsSection({
    id: "fleets",
    title: "Fleets: credentials and polling",
    description: "The tokens and logins fleets read their tracker and forge with, and how often each fleet is polled.",
    component: CredentialsSettings,
  });

  // A bb without the overlay slot has no window-wide place to listen for a new Inbox row.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "inbox-toasts", component: InboxToasts });
  }
});
