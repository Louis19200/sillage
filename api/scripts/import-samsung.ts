/**
 * Importe l'historique d'un export Samsung Health (pas + sommeil) dans l'API déployée.
 *
 *   pnpm --filter api samsung:import "C:\chemin\vers\le\dossier\exporté"          # aperçu, n'envoie rien
 *   pnpm --filter api samsung:import "C:\chemin\vers\le\dossier\exporté" --send   # envoie
 *
 * Fichiers lus dans le dossier (ou un sous-dossier) :
 *   com.samsung.shealth.tracker.pedometer_day_summary.*.csv
 *   com.samsung.shealth.sleep_combined.*.csv
 *
 * Variables (environnement, `api/.env` ou `.env` à la racine) : API_URL, INGEST_TOKEN.
 * Idempotent : relancer ne crée pas de doublon (upsert par date côté API) et ne touche
 * jamais aux commits. Aujourd'hui (journée incomplète) n'est pas envoyé.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { HealthIngestBody, IngestResult, type HealthDay } from "@sillage/shared";

import { buildHealthDays, parseSamsungCsv, sleepByDate, stepsByDate } from "../src/collectors/samsung-export/parse";
import { loadDotenvFiles } from "../src/env";

const BATCH = 365;
const STEPS_FILE = /^com\.samsung\.shealth\.tracker\.pedometer_day_summary\..*\.csv$/;
const SLEEP_FILE = /^com\.samsung\.shealth\.sleep_combined\..*\.csv$/;

function findFile(dir: string, pattern: RegExp, depth = 2): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) if (pattern.test(name)) return join(dir, name);
  if (depth > 0) {
    for (const name of entries) {
      const p = join(dir, name);
      try {
        if (statSync(p).isDirectory()) {
          const found = findFile(p, pattern, depth - 1);
          if (found) return found;
        }
      } catch {
        // dossier illisible : on continue
      }
    }
  }
  return null;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function describe(day: HealthDay): string {
  const steps = day.steps !== undefined ? `${day.steps} pas` : "pas : —";
  const sleep =
    day.sleep_minutes != null
      ? `sommeil ${Math.floor(day.sleep_minutes / 60)} h ${String(day.sleep_minutes % 60).padStart(2, "0")} (${day.sleep_start?.slice(11, 16)} → ${day.sleep_end?.slice(11, 16)})`
      : "sommeil : —";
  return `  ${day.date}  ${steps}, ${sleep}`;
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error('Usage : pnpm --filter api samsung:import "<dossier de l\'export Samsung Health>" [--send]');
    process.exit(2);
  }

  const stepsPath = findFile(dir, STEPS_FILE);
  const sleepPath = findFile(dir, SLEEP_FILE);
  if (!stepsPath && !sleepPath) {
    console.error(
      `Aucun fichier Samsung Health trouvé dans ${dir}.\n` +
        "Attendus : com.samsung.shealth.tracker.pedometer_day_summary.*.csv et/ou com.samsung.shealth.sleep_combined.*.csv",
    );
    process.exit(2);
  }
  console.log(`Pas     : ${stepsPath ?? "fichier absent"}`);
  console.log(`Sommeil : ${sleepPath ?? "fichier absent"}`);

  const steps = stepsPath ? stepsByDate(parseSamsungCsv(readFileSync(stepsPath, "utf8"))) : new Map<string, number>();
  const sleep = sleepPath ? sleepByDate(parseSamsungCsv(readFileSync(sleepPath, "utf8"))) : new Map();
  const days = buildHealthDays(steps, sleep, localToday());
  if (days.length === 0) {
    console.error("Aucune journée exploitable dans ces fichiers.");
    process.exit(1);
  }

  const withSteps = days.filter((d) => d.steps !== undefined).length;
  const withSleep = days.filter((d) => d.sleep_minutes != null).length;
  console.log(
    `\n${days.length} journées du ${days[0]!.date} au ${days[days.length - 1]!.date} : ` +
      `${withSteps} avec des pas, ${withSleep} avec du sommeil.`,
  );
  console.log("Dernières journées :");
  for (const d of days.slice(-5)) console.log(describe(d));

  if (!send) {
    console.log("\nAperçu seulement : rien n'a été envoyé. Relance avec --send pour importer.");
    return;
  }

  const apiUrl = (process.env.API_URL ?? "").replace(/\/+$/, "");
  const token = process.env.INGEST_TOKEN ?? "";
  if (!apiUrl || !token) {
    console.error("API_URL et INGEST_TOKEN sont nécessaires dans .env pour envoyer.");
    process.exit(2);
  }

  let total = 0;
  for (let i = 0; i < days.length; i += BATCH) {
    const body = HealthIngestBody.parse({ days: days.slice(i, i + BATCH) });
    const res = await fetch(`${apiUrl}/ingest/health`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`envoi refusé (${res.status}) pour ${body.days[0]!.date} → ${body.days.at(-1)!.date} : ${text.slice(0, 300)}`);
    }
    const { upserted } = IngestResult.parse(JSON.parse(text));
    total += upserted;
    console.log(`  ${body.days[0]!.date} → ${body.days.at(-1)!.date} : ${upserted} journées enregistrées`);
  }
  console.log(`\nTerminé : ${total} journées importées.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
