/**
 * Backfill du contexte par lots d'un an (script `context:backfill`).
 * Chaque lot : météo puis Kp, chacun lu en entier puis écrit en une transaction,
 * avec sa ligne `ingest_log`. Un lot en échec arrête tout ; les lots précédents
 * restent écrits et le message dit comment reprendre.
 */
import { getDb, type Db } from "../db";
import type { FetchLike } from "../collectors/weather/client";
import { addDays, dateRange, splitRange, todayIn } from "./dates";
import { firstMetricsDate, type Position } from "./store";
import { contextTimeZone, syncKp, syncWeather, type SyncKpResult, type SyncWeatherResult } from "./sync";

/** Premier jour de l'historique (import Samsung), si daily_metrics est vide. */
export const HISTORY_START = "2019-07-05";
export const CHUNK_DAYS = 365;
export const PAUSE_BETWEEN_CHUNKS_MS = 2_000;
/** Pause entre deux requêtes Open-Meteo d'un même lot (plusieurs positions). */
export const BACKFILL_PAUSE_MS = 1_000;

export type BackfillOptions = {
  from?: string;
  to?: string;
  only?: "weather" | "kp";
  tz?: string;
  home?: Position | null;
  now?: Date;
  db?: Db;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

export type BackfillChunk = { from: string; to: string; weather?: SyncWeatherResult; kp?: SyncKpResult };

export async function backfillContext(opts: BackfillOptions = {}): Promise<BackfillChunk[]> {
  const db = opts.db ?? getDb();
  const tz = opts.tz ?? contextTimeZone();
  const log = opts.log ?? ((m: string) => console.log(m));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const today = todayIn(tz, opts.now ?? new Date());
  const from = opts.from ?? (await firstMetricsDate(db.executor)) ?? HISTORY_START;
  const to = opts.to ?? addDays(today, -1);
  if (from > to) throw new Error(`plage vide : ${from} → ${to}`);

  const chunks = splitRange(from, to, CHUNK_DAYS);
  log(`context : backfill ${from} → ${to} en ${chunks.length} lot(s) d'un an au plus (fuseau ${tz})`);
  const done: BackfillChunk[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const tag = `lot ${i + 1}/${chunks.length} (${chunk.from} → ${chunk.to})`;
    const result: BackfillChunk = { ...chunk };
    try {
      if (opts.only !== "kp") {
        result.weather = await syncWeather({
          dates: dateRange(chunk.from, chunk.to),
          today,
          db,
          fetch: opts.fetch,
          sleep,
          pauseMs: BACKFILL_PAUSE_MS,
          ...(opts.home !== undefined ? { home: opts.home } : {}),
        });
        log(`${tag} météo : ${result.weather.days_written} journées écrites, ${result.weather.days_empty} sans données, ${result.weather.requests} requête(s)`);
      }
      if (opts.only !== "weather") {
        result.kp = await syncKp({ from: chunk.from, to: chunk.to, tz, db, fetch: opts.fetch, sleep });
        log(`${tag} Kp : ${result.kp.days_written} journées écrites`);
      }
    } catch (err) {
      throw new Error(
        `${tag} : ${err instanceof Error ? err.message : String(err)}\n` +
          `Les lots précédents sont écrits. Reprendre avec : pnpm --filter api context:backfill -- --from ${chunk.from}${opts.only ? ` --only ${opts.only}` : ""}`,
      );
    }
    done.push(result);
    if (i < chunks.length - 1) await sleep(PAUSE_BETWEEN_CHUNKS_MS);
  }
  log("context : backfill terminé");
  return done;
}
