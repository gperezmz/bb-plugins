// Cache Keeper's frontend entry: the composer chip and banner on thread
// composers, the sidebar glyph, and the nav page.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Banner, Chip, KEEPER_ICON, mountRowStatus, Page } from "@/features/cache-keeper";

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
    icon: KEEPER_ICON,
    path: "cache-keeper",
    component: Page,
  });
});
