// The opt-in render benchmark; see list-render.perf.tsx.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../", import.meta.url)) },
  },
  test: {
    root: fileURLToPath(new URL("../", import.meta.url)),
    include: ["perf/**/*.perf.tsx"],
  },
});
