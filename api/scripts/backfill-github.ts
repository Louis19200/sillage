/**
 * Remplit `daily_metrics.commits` depuis GitHub.
 *
 *   pnpm --filter api github:backfill     # 365 derniers jours
 *   pnpm --filter api github:sync         # 7 derniers jours (= la tâche nocturne)
 *   tsx scripts/backfill-github.ts --days 30
 *
 * Variables : DATABASE_URL, GITHUB_TOKEN, GITHUB_LOGIN (environnement, `api/.env`
 * ou `.env` à la racine). Idempotent : peut être relancé sans risque.
 */
import { closeDb } from "../src/db";
import { loadDotenvFiles } from "../src/env";
import { lastDays, syncGithub } from "../src/collectors/github/sync";

function parseDays(argv: string[]): number {
  const i = argv.indexOf("--days");
  if (i === -1) return 365;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    throw new Error(`--days attend un entier entre 1 et 3650 (reçu ${JSON.stringify(argv[i + 1])})`);
  }
  return n;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const days = parseDays(process.argv.slice(2));
  const { from, to } = lastDays(days);
  console.log(`github : synchro des ${days} derniers jours (${from.toISOString()} → ${to.toISOString()})…`);
  const result = await syncGithub({ from, to });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
