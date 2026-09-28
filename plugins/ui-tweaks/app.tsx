// UI Tweaks' frontend entry: the settings rows, the listener that keeps each
// window's copy of the tweaks current, and the content script that applies them.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountTweaks, TweaksSection, TweaksSync } from "@/features/ui-tweaks";

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "ui-tweaks", component: TweaksSection });
  app.slots.experimental_appOverlay({ id: "sync", component: TweaksSync });
  app.contentScripts.register({ id: "tweaks", mount: mountTweaks });
});
