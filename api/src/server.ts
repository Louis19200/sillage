/**
 * Point d'entrée : lit l'environnement, ouvre la base, écoute sur PORT.
 * `pnpm --filter api dev` (rechargement) ou `pnpm --filter api start`.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { closeDb, getDb } from "./db";
import { EnvError, loadDotenvFiles, loadEnv } from "./env";
import { startJobs, stopJobs } from "./jobs";

loadDotenvFiles();

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(err instanceof EnvError ? err.message : err);
  console.error("Démarrage refusé.");
  process.exit(1);
}

const db = getDb();
const app = createApp({ db, ingestToken: env.INGEST_TOKEN, protectReads: env.PROTECT_READS });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`sillage api : http://localhost:${info.port} (lecture ${env.PROTECT_READS ? "protégée" : "publique"})`);
});

const jobs = startJobs(env.ENABLE_JOBS);
console.log(env.ENABLE_JOBS ? `tâches planifiées : ${jobs.join(", ") || "aucune"}` : "tâches planifiées désactivées (ENABLE_JOBS)");

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu, arrêt…`);
  await stopJobs();
  server.close();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
