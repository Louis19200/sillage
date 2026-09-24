/**
 * Base PGlite en mémoire, migrée, pour les tests (réutilisable par les autres zones).
 */
import { PGlite } from "@electric-sql/pglite";
import { createDb, pgliteExecutor, type Db } from "../src/db";
import { migrate } from "../src/migrate";

export const TEST_TOKEN = "t".repeat(16) + "0123456789abcdef"; // 32 caractères

export async function createTestDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const db = createDb(pgliteExecutor(pg));
  await migrate(db.executor);
  return { db, pg };
}

/** Vide les tables sans recréer la base (plus rapide qu'une nouvelle instance PGlite). */
export async function resetTestDb(db: Db): Promise<void> {
  await db.executor.exec("TRUNCATE daily_metrics, ingest_log RESTART IDENTITY");
}
