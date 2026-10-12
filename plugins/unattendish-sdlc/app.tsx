// Unattendish frontend entry: registers the plugin's pages with bb's slots.
//   the Fleets page, with its count in the page header;
//   the Fleet chip in a manager thread's header, and the Fleet tab it opens;
//   the overlays: the toast for a new Inbox row, the toast for a fleet that needs an account, and the Connect popup;
//   the settings section for accounts and poll intervals.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AccountsSettings } from "@/features/accounts-settings";
import { FleetChip } from "@/features/fleet-chip";
import { FleetTab } from "@/features/fleet-tab";
import { FleetsHeaderCount, FleetsPage } from "@/features/fleets-page";
import { InboxToasts } from "@/features/inbox-toasts";
import { NeedsToasts } from "@/features/needs-toasts";
import { ConnectOverlay } from "@/shared/connect/ConnectOverlay";
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
    title: "Fleets: accounts and polling",
    description: "The accounts fleets read their tracker and forge as, the tokens and logins they hold, and how often each fleet is polled.",
    component: AccountsSettings,
  });

  // A bb without the overlay slot has no window-wide place to listen for a new Inbox row or to draw the Connect popup over the current view.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "inbox-toasts", component: InboxToasts });
    app.slots.experimental_appOverlay({ id: "needs-toasts", component: NeedsToasts });
    app.slots.experimental_appOverlay({ id: "connect-popup", component: ConnectOverlay });
  }
});
