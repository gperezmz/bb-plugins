// Thread Glance frontend entry: registers the sidebar thread list.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

/** Stands in for the shelf list until it is built. */
function ThreadList() {
  return <div role="status">Thread Glance</div>;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-glance",
    title: "Thread Glance",
    description: "Shelves for every thread: active, snoozed, parked and settled.",
    component: ThreadList,
  });
});
