// `npm run perf`, the Chromium step: timings on React's production build, the
// build bb ships, in headless Chromium through Playwright. CHROMIUM_PATH
// points at a system Chromium where Playwright's own download cannot run.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  mode: "production",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwindcss()],
  resolve: {
    alias: { "@": root },
  },
  test: {
    root,
    include: ["perf/**/*.browser.perf.tsx"],
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
