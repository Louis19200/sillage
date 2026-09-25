/**
 * Vérifie le client de synchro contre une vraie API, sans téléphone : un faux Health Connect
 * produit les journées (via computeLastCompleteDays), le vrai client les envoie avec le
 * `fetch` de Node, puis on les relit avec GET /day/:date.
 *
 *   SILLAGE_API_URL=http://localhost:8787 INGEST_TOKEN=... pnpm --filter @sillage/app check-api
 *
 * ATTENTION : écrit 30 journées FACTICES. Refuse donc toute API non locale, sauf
 * SILLAGE_ALLOW_REMOTE=1 (à ne jamais faire sur la base de production).
 *
 * Le token est lu dans l'environnement et n'est jamais affiché.
 */
import { DailyMetrics } from "@sillage/shared";

import { ingestHealthDays } from "../src/api";
import { computeLastCompleteDays, localDateOf, type HealthReader } from "../src/days";

const baseUrl = process.env.SILLAGE_API_URL ?? "http://localhost:8787";
const token = process.env.INGEST_TOKEN ?? "";
const count = Number(process.env.SILLAGE_DAYS ?? 30);

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseUrl) && process.env.SILLAGE_ALLOW_REMOTE !== "1") {
  console.error(
    `check-api écrit des journées FACTICES : refus d'écrire dans ${baseUrl}.\n` +
      "Utilise une API locale (voir api/README.md). Pour vérifier la production sans rien écrire : node api/scripts/check-prod.mjs",
  );
  process.exit(2);
}

/** Faux Health Connect : 1 jour sur 4 sans données (null), 1 jour à 0 pas, une nuit chaque jour sauf les jours vides. */
function fakeReader(now: Date): HealthReader {
  const empty = (d: Date) => d.getDate() % 4 === 0;
  return {
    async aggregateSteps(start) {
      if (empty(start)) return { total: 0, dataOrigins: [] };
      if (start.getDate() % 5 === 0) return { total: 0, dataOrigins: ["fake.phone"] };
      return { total: 4000 + start.getDate() * 211, dataOrigins: ["fake.phone"] };
    },
    async readSleepSessions(start, end) {
      const sessions = [];
      for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const wake = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 5);
        if (empty(wake) || wake >= now) continue;
        const bed = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 20);
        sessions.push({ startTime: bed.toISOString(), endTime: wake.toISOString() });
      }
      return sessions;
    },
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const days = await computeLastCompleteDays(fakeReader(now), count, now);
  console.log(`${days.length} journées calculées (${days[0]?.date} → ${days.at(-1)?.date}), aujourd'hui = ${localDateOf(now)}`);

  const outcome = await ingestHealthDays({ baseUrl, token, days, fetch: (u, i) => fetch(u, i) });
  console.log("POST /ingest/health :", JSON.stringify(outcome));
  if (!outcome.ok) process.exit(1);

  let mismatches = 0;
  for (const sent of [days[0], days.at(-1)]) {
    if (!sent) continue;
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/day/${sent.date}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const stored = DailyMetrics.parse(await res.json());
    const same =
      stored.steps === sent.steps &&
      stored.sleep_minutes === sent.sleep_minutes &&
      (stored.sleep_start === null) === (sent.sleep_start === null) &&
      (sent.sleep_start === null || Date.parse(stored.sleep_start ?? "") === Date.parse(sent.sleep_start)) &&
      (sent.sleep_end === null || Date.parse(stored.sleep_end ?? "") === Date.parse(sent.sleep_end));
    console.log(`GET /day/${sent.date} : ${same ? "identique" : "DIFFÉRENT"}`, JSON.stringify(stored));
    if (!same) mismatches++;
  }

  const bad = await ingestHealthDays({ baseUrl, token: "mauvais-token", days, fetch: (u, i) => fetch(u, i) });
  console.log("Avec un faux token :", JSON.stringify(bad));
  if (bad.ok || bad.kind !== "unauthorized") mismatches++;

  process.exit(mismatches === 0 ? 0 : 1);
}

void main();
