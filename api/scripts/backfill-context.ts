/**
 * Remplit `daily_context` (météo Open-Meteo + Kp GFZ).
 *
 *   pnpm --filter api context:backfill                       # 1re journée de daily_metrics → hier
 *   pnpm --filter api context:backfill -- --from 2023-01-01  # reprendre à partir d'une date
 *   pnpm --filter api context:backfill -- --only weather     # ou --only kp
 *   pnpm --filter api context:sync                           # = la tâche context-sync (7 derniers jours)
 *
 * Variables : DATABASE_URL, HOME_LAT, HOME_LON, CONTEXT_TZ (facultatif, défaut
 * Europe/Paris), dans l'environnement, `api/.env` ou `.env` à la racine.
 * Lots d'un an, tout ou rien par lot, idempotent : voir src/context/backfill.ts.
 */
import { IsoDate } from "@sillage/shared";
import { closeDb } from "../src/db";
import { loadDotenvFiles } from "../src/env";
import { backfillContext, type BackfillOptions } from "../src/context/backfill";
import { runContextSyncJob } from "../src/context/sync";

type Args = Pick<BackfillOptions, "from" | "to" | "only"> & { recent: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { recent: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} attend une valeur`);
      return v;
    };
    if (a === "--") continue;
    if (a === "--recent") args.recent = true;
    else if (a === "--from" || a === "--to") {
      const v = value();
      if (!IsoDate.safeParse(v).success) throw new Error(`${a} attend une date YYYY-MM-DD (reçu ${JSON.stringify(v)})`);
      if (a === "--from") args.from = v;
      else args.to = v;
    } else if (a === "--only") {
      const v = value();
      if (v !== "weather" && v !== "kp") throw new Error(`--only attend weather ou kp (reçu ${JSON.stringify(v)})`);
      args.only = v;
    } else throw new Error(`argument inconnu : ${a}`);
  }
  return args;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const { recent, ...opts } = parseArgs(process.argv.slice(2));
  if (recent) {
    console.log("context : synchro des 7 derniers jours (tâche context-sync)…");
    console.log(JSON.stringify(await runContextSyncJob(), null, 2));
    return;
  }
  await backfillContext(opts);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
