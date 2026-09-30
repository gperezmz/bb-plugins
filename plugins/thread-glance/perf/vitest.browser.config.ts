// `npm run perf`, the Chromium step: timings on React's production build, the
// build bb ships, in headless Chromium through Playwright. CHROMIUM_PATH
// points at a system Chromium where Playwright's own download cannot run.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { perfCdp, perfLiveInstances } from "./harness/cdp-commands";

const root = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  mode: "production",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // JSX compiled for the production runtime, which has no `jsxDEV`.
  oxc: { jsx: { development: false } },
  plugins: [tailwindcss()],
  // Found mid-run, either would make Vite re-optimize and reload the page:
  // the fake host imports bb's SDK app module late, to put its hooks in
  // first, and production JSX needs the runtime the development build skips.
  optimizeDeps: { include: ["@get-bb/plugin-sdk/app", "react/jsx-runtime"] },
  resolve: {
    alias: { "@": root },
  },
  test: {
    root,
    include: ["perf/**/*.browser.perf.tsx"],
    setupFiles: ["perf/harness/production-act.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      }),
      instances: [{ browser: "chromium" }],
      commands: { perfCdp, perfLiveInstances },
    },
  },
});
