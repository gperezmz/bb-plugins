// Thread Glance frontend entry: registers the sidebar thread list, its settings
// section, the icons bb lacks, and where bb offers its always-mounted app
// overlay slot, the component there that keeps the list's data current while
// bb's Settings or Plugins page has the sidebar unmounted.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SettingsPage } from "@/features/settings";
import { ThreadActionDialogs, registerThreadActions } from "@/features/thread-actions";
import { ChildrenButton, ParentButton } from "@/features/thread-header";
import { EXTRA_ICONS, OverlaySyncKeeper, ThreadList } from "@/features/thread-list";
import "@/features/thread-list/theme/theme.css";

export default definePluginApp((app) => {
  for (const [name, component] of Object.entries(EXTRA_ICONS)) app.experimental_icons.register({ name, component });
  app.slots.experimental_threadList({
    id: "thread-glance",
    title: "Thread Glance",
    description: "Shelves for every thread: active, snoozed, parked and settled.",
    component: ThreadList,
  });
  app.slots.settingsSection({ id: "thread-glance", component: SettingsPage });
  app.slots.experimental_threadHeaderAction({ id: "thread-glance-parent", title: "Parent thread", component: ParentButton });
  app.slots.experimental_threadHeaderAction({ id: "thread-glance-children", title: "Child threads", component: ChildrenButton });
  // A bb without the slot has the list follow realtime itself instead.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "thread-glance-sync", component: OverlaySyncKeeper });
    app.slots.experimental_appOverlay({ id: "thread-glance-dialogs", component: ThreadActionDialogs });
  }
  // Snooze, Park, Settle, Parent… and the rest join bb's thread menu; a bb without the slot has no menu to join.
  if (typeof app.slots.experimental_threadAction === "function") registerThreadActions(app);
});
