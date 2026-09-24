// Thread Glance frontend entry: registers the sidebar thread list.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ThreadList } from "@/features/thread-list";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-glance",
    title: "Thread Glance",
    description: "Every thread's state, harness and child threads at a glance.",
    component: ThreadList,
  });
});
