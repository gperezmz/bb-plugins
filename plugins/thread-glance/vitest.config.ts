import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
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
        // Pre-bundled up front: Vite otherwise finds these during the first run
        // on a cold cache, as in CI, and reloads the page under a running test.
        optimizeDeps: {
          include: [
            "@get-bb/plugin-sdk/app",
            "@hugeicons/core-free-icons",
            "@radix-ui/react-context-menu",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-hover-card",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-slot",
            "@radix-ui/react-tooltip",
            "class-variance-authority",
            "clsx",
            "react",
            "react-day-picker",
            "react-dom",
            "react/jsx-dev-runtime",
            "sonner",
            "tailwind-merge",
          ],
        },
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
