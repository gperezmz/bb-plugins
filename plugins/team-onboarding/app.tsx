// Team Onboarding's frontend: the Onboarding page with its badge, header and
// fixed tabs, the Setup home section, and the manifest file's status in Settings.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PANEL_ID, PANEL_PATH } from "./src/ui/hooks.js";
import { ManifestTab } from "./src/ui/manifest-tab.js";
import { HomeSection, OnboardingBadge, OnboardingHeader, OnboardingPage, SettingsSection } from "./src/ui/page.js";
import { manifestTab } from "./src/ui/tabs.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_ID,
    title: "Onboarding",
    icon: "ListTodo",
    path: PANEL_PATH,
    component: OnboardingPage,
    headerContent: OnboardingHeader,
    experimental_sidebarAccessory: OnboardingBadge,
    // The registrations are the same objects the page passes to
    // openFixedTab: the host matches tab references by identity.
    // Terminals show under the item that opened them, not in a tab. bb
    // 0.43.4 draws a plugin's branding icon on its fixed tabs whatever `icon`
    // says; FileText is what it should show.
    fixedTabs: [Object.assign(manifestTab, { title: "Team manifest", icon: "FileText", component: ManifestTab })],
  });
  app.slots.homepageSection({ id: "setup", title: "Setup", component: HomeSection });
  app.slots.settingsSection({
    id: "manifest-file",
    title: "Manifest file",
    description: "Where the plugin reads your team's onboarding.yaml on the bb server, and whether it is valid.",
    component: SettingsSection,
  });
});
