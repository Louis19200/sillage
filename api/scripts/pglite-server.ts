/**
 * Postgres jetable sans Docker : PGlite en mémoire exposé sur le protocole
 * Postgres (port 5433 par défaut). Données perdues à l'arrêt.
 *
 *   pnpm --filter api db:pglite
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres pnpm --filter api migrate
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.PGLITE_PORT ?? 5433);
const db = new PGlite();
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log(`PGlite en écoute : postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
