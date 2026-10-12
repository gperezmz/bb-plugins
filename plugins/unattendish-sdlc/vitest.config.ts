import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // The server's tests run in Node; a screen test opts into jsdom with `// @vitest-environment jsdom`.
    include: [
      "src/**/*.test.ts",
      "test/**/*.test.ts",
      "features/**/*.test.{ts,tsx}",
      "shared/**/*.test.{ts,tsx}",
      "*.test.{ts,tsx}",
    ],
    testTimeout: 30_000,
  },
});
