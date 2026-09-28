// Pocket Navigation frontend entry: registers the sidebar navigation.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PocketNavigation } from "@/features/pocket-navigation";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "pocket-navigation",
    title: "Pocket Navigation",
    description: "On a phone, a New thread line above one row of icons; elsewhere, bb's own navigation.",
    component: PocketNavigation,
  });
});
