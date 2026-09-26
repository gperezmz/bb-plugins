// Thread Glance frontend entry: registers the sidebar thread list and the
// footer item that opens its settings.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SettingsDisclosure, ThreadList } from "@/features/thread-list";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-glance",
    title: "Thread Glance",
    description: "Every thread's state, harness and child threads at a glance.",
    component: ThreadList,
  });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "settings",
    label: "Thread Glance",
    // The icon package.json brands the plugin with; bb's gear beside it is bb's settings.
    icon: "ListView",
    component: SettingsDisclosure,
  });
});
