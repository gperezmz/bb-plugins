// Thread Glance frontend entry: registers the sidebar thread list, and where
// bb offers its always-mounted app overlay slot, the component there that
// keeps the list's data current while bb's Settings or Plugins page has the
// sidebar unmounted. The list's settings open from its header.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { OverlaySyncKeeper, ThreadList } from "@/features/thread-list";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-glance",
    title: "Thread Glance",
    description: "Every thread's state, harness and child threads at a glance.",
    component: ThreadList,
  });
  // A bb without the slot has the list follow realtime itself instead.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "thread-glance-sync", component: OverlaySyncKeeper });
  }
});
