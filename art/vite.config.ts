import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // Plusieurs pages : `/` (page du jour) et `/gallery/` (galerie). Sur Vercel, `dist/gallery/index.html`
      // est servi tel quel à `/gallery/`, sans réécriture.
      input: {
        day: page("./index.html"),
        gallery: page("./gallery/index.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // La composition de 120 scènes dépasse 5 s quand la machine est chargée (tests en parallèle).
    testTimeout: 30_000,
    environment: "node",
  },
});
