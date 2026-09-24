import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5173 },
  test: {
    include: ["src/**/*.test.ts"],
    // La composition de 120 scènes dépasse 5 s quand la machine est chargée (tests en parallèle).
    testTimeout: 30_000,
    environment: "node",
  },
});
