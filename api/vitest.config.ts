import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Le démarrage de PGlite (WASM) peut prendre quelques secondes sur une machine chargée.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
