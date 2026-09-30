// `npm run perf`: the plugin server's signals, mount payload and first read,
// and the bundle's size.
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { generateList } from "@/features/thread-list/testing/fixtures";
import { buildAndMeasure } from "./harness/bundle";
import { writeFragment } from "./harness/results";
import { runServer } from "./harness/server-run";

it("measures the server and the bundle", async () => {
  const server = await runServer(generateList({ size: 1_500 }).threads.map((thread) => thread.id));
  const bundle = buildAndMeasure(fileURLToPath(new URL("../", import.meta.url)));
  writeFragment("server", { server, bundle });
});
