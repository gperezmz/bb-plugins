import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // The server's tests run in Node; a screen test opts into jsdom with `// @vitest-environment jsdom`.
    include: ["test/**/*.test.ts", "features/**/*.test.{ts,tsx}", "*.test.{ts,tsx}"],
  },
});
