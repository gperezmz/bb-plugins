// `npm run perf`, first and last steps: the harness's jsdom, fake host, server
// and bundle measurements, then the ledger's report over every figure the
// steps wrote to perf/results/. The Chromium step has its own config
// (vitest.browser.config.ts), because it runs React's production build.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    root,
    setupFiles: ["features/thread-list/testing/jsdom-viewport.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "harness",
          include: ["perf/**/*.perf.{ts,tsx}"],
          exclude: ["perf/**/*.browser.perf.tsx", "perf/ledger.perf.ts"],
          testTimeout: 3_600_000,
          hookTimeout: 600_000,
        },
      },
      {
        extends: true,
        // Its tables are the run's output, printed whether or not it passes.
        test: { name: "ledger", include: ["perf/ledger.perf.ts"], disableConsoleIntercept: true },
      },
    ],
  },
});
