// Pocket Navigation frontend entry: registers the sidebar navigation.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PocketNavigation } from "@/features/pocket-navigation";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "pocket-navigation",
    title: "Pocket Navigation",
    description: "On a phone, one row of icons and a New thread line; elsewhere, bb's own navigation.",
    component: PocketNavigation,
  });
});
