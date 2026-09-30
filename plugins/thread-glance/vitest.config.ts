import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // Two workers keep a run under 4 GiB (a unit worker peaks near 1.8 GiB,
    // a browser worker near 1.3 GiB) on a machine shared with other work.
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.{ts,tsx}"],
          setupFiles: ["features/thread-list/testing/jsdom-viewport.ts"],
          exclude: ["node_modules/**", "dist/**", "**/*.browser.test.{ts,tsx}"],
        },
      },
      // Layout needs a layout engine: these run in Chromium, styled by
      // Tailwind's default theme rather than bb's, so they check where boxes
      // go, not bb's exact pixels. CHROMIUM_PATH points at a system Chromium
      // where Playwright's own download cannot run.
      {
        extends: true,
        plugins: [tailwindcss()],
        test: {
          name: "browser",
          include: ["**/*.browser.test.{ts,tsx}"],
          exclude: ["node_modules/**", "dist/**"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
