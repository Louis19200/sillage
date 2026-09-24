/**
 * Exécuteur de migrations : applique `api/db/migrations/*.sql` par ordre de nom,
 * chacune dans sa transaction, et les trace dans `schema_migrations`.
 * Idempotent : une migration déjà tracée n'est jamais rejouée.
 *
 * En ligne de commande : `pnpm --filter api migrate` (utilise DATABASE_URL).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPostgresClient, postgresClientOptions, postgresExecutor, type SqlExecutor } from "./db";
import { loadDatabaseConfig, loadDotenvFiles } from "./env";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

export async function migrate(
  executor: SqlExecutor,
  dir: string = MIGRATIONS_DIR,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  await executor.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await executor.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name),
  );

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = await readFile(join(dir, file), "utf8");
    await executor.transaction(async (tx) => {
      await tx.exec(sqlText);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    log(`migration appliquée : ${file}`);
    newlyApplied.push(file);
  }
  if (newlyApplied.length === 0) log("base à jour, aucune migration à appliquer");
  return newlyApplied;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const { url, serverless } = loadDatabaseConfig();
  const executor = postgresExecutor(createPostgresClient(url, { ...postgresClientOptions(serverless), max: 1 }));
  try {
    await migrate(executor, MIGRATIONS_DIR, (m) => console.log(m));
  } finally {
    await executor.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
