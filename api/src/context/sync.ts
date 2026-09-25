/**
 * Synchronisation du contexte : météo (Open-Meteo) et Kp (GFZ) → `daily_context`.
 *
 *  - `syncWeather({ dates })` : météo de chaque date à la position du jour
 *    (téléphone), sinon « maison » (HOME_LAT / HOME_LON). Requêtes regroupées par
 *    suite de jours consécutifs au même endroit, archive pour le passé, prévision
 *    pour les `RECENT_DAYS` derniers jours. Tout est lu avant d'écrire, puis une
 *    seule transaction : tout ou rien. Une ligne `ingest_log` (source `weather`).
 *  - `syncKp({ from, to })` : Kp maximal par journée locale (fuseau CONTEXT_TZ).
 *    Une ligne `ingest_log` (source `kp`).
 *  - `runContextSyncJob()` : tâche `context-sync` (7 derniers jours complets, plus
 *    les journées dont la position a changé depuis le calcul de leur météo).
 *
 * Jamais de coordonnées dans les messages, les journaux ou les résultats.
 * Sans état en mémoire : utilisable tel quel dans une fonction serverless.
 */
import { roundCoord } from "@sillage/shared";
import { getDb, type Db } from "../db";
import {
  MAX_SPAN_DAYS,
  defaultSleep,
  fetchWeather,
  isEmptyWeather,
  type FetchLike,
  type WeatherEndpoint,
  type WeatherRequest,
} from "../collectors/weather/client";
import { BIN_MS, dailyKpMax, fetchKp } from "../collectors/kp/client";
import { addDays, assertTimeZone, dateRange, daysBetween, localDayBounds, todayIn } from "./dates";
import {
  getPhonePositions,
  staleWeatherDates,
  upsertKp,
  upsertWeather,
  type Position,
  type WeatherRow,
} from "./store";

export const WEATHER_SOURCE = "weather";
export const KP_SOURCE = "kp";

/** Jours récents servis par l'API de prévision (l'archive a quelques jours de retard). */
export const RECENT_DAYS = 14;
/** Pause entre deux requêtes Open-Meteo (limite gratuite : 600 appels/min, 5 000/h, 10 000/jour). */
export const DEFAULT_PAUSE_MS = 400;
/** Journées « position changée » recalculées au plus par exécution de la tâche. */
export const MAX_STALE_PER_RUN = 60;
export const DEFAULT_TZ = "Europe/Paris";

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement)
// ---------------------------------------------------------------------------

/** Fuseau des journées locales pour « aujourd'hui » et le Kp (`CONTEXT_TZ`, défaut Europe/Paris). */
export function contextTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const tz = env.CONTEXT_TZ?.trim() || DEFAULT_TZ;
  assertTimeZone(tz);
  return tz;
}

/**
 * Position « maison » (`HOME_LAT`, `HOME_LON`), arrondie à 2 décimales.
 * `null` si elle n'est pas définie ; erreur claire (sans la valeur) si elle est invalide.
 */
export function homePosition(env: NodeJS.ProcessEnv = process.env): Position | null {
  const rawLat = env.HOME_LAT?.trim() ?? "";
  const rawLon = env.HOME_LON?.trim() ?? "";
  if (rawLat === "" && rawLon === "") return null;
  if (rawLat === "" || rawLon === "") throw new Error("HOME_LAT et HOME_LON doivent être définies ensemble");
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("HOME_LAT invalide : nombre décimal entre -90 et 90 attendu (ex. 48.85)");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("HOME_LON invalide : nombre décimal entre -180 et 180 attendu (ex. 2.35)");
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function safeLogIngest(db: Db, entry: Parameters<Db["logIngest"]>[0]): Promise<void> {
  try {
    await db.logIngest(entry);
  } catch (err) {
    console.error(`${entry.source} : impossible de journaliser`, errorMessage(err));
  }
}

// ---------------------------------------------------------------------------
// Météo
// ---------------------------------------------------------------------------

export type WeatherSegment = WeatherRequest & { source: "phone" | "home"; dates: string[] };

/**
 * Regroupe les dates en requêtes : jours consécutifs, même position, même
 * point d'accès (archive avant `today - RECENT_DAYS`, prévision ensuite),
 * au plus `MAX_SPAN_DAYS` jours par requête.
 */
export function planWeatherRequests(
  dates: readonly string[],
  positionOf: (date: string) => { position: Position; source: "phone" | "home" },
  today: string,
): WeatherSegment[] {
  const recentFrom = addDays(today, -RECENT_DAYS);
  const segments: WeatherSegment[] = [];
  for (const date of [...new Set(dates)].sort()) {
    const { position, source } = positionOf(date);
    const endpoint: WeatherEndpoint = date >= recentFrom ? "forecast" : "archive";
    const cur = segments.at(-1);
    if (
      cur &&
      cur.endpoint === endpoint &&
      cur.lat === position.lat &&
      cur.lon === position.lon &&
      cur.source === source &&
      addDays(cur.end, 1) === date &&
      daysBetween(cur.start, date) < MAX_SPAN_DAYS
    ) {
      cur.end = date;
      cur.dates.push(date);
    } else {
      segments.push({ endpoint, lat: position.lat, lon: position.lon, start: date, end: date, source, dates: [date] });
    }
  }
  return segments;
}

export type SyncWeatherOptions = {
  dates: readonly string[];
  /** Date locale du jour (pour choisir archive / prévision). Défaut : aujourd'hui dans CONTEXT_TZ. */
  today?: string;
  /** Défaut : HOME_LAT / HOME_LON. */
  home?: Position | null;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
  db?: Db;
};

export type SyncWeatherResult = {
  source: "weather";
  days_requested: number;
  days_written: number;
  /** Journées pour lesquelles Open-Meteo n'a encore rien (archive pas à jour) : non écrites. */
  days_empty: number;
  requests: number;
  first_date: string | null;
  last_date: string | null;
};

export async function syncWeather(opts: SyncWeatherOptions): Promise<SyncWeatherResult> {
  const db = opts.db ?? getDb();
  const sleep = opts.sleep ?? defaultSleep;
  const pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS;
  const dates = [...new Set(opts.dates)].sort();
  const first = dates[0] ?? null;
  const last = dates.at(-1) ?? null;

  let written = 0;
  let empty = 0;
  let requests = 0;
  let firstWritten: string | null = null;
  let lastWritten: string | null = null;
  try {
    if (!first || !last) throw new Error("aucune date à synchroniser");
    const today = opts.today ?? todayIn(contextTimeZone());
    const home = opts.home === undefined ? homePosition() : opts.home;
    const phone = await getPhonePositions(db.executor, first, last);

    const missing = dates.filter((d) => !phone.has(d));
    if (missing.length > 0 && !home) {
      throw new Error(
        `HOME_LAT / HOME_LON manquantes : ${missing.length} journée(s) sans position du téléphone (ex. ${missing[0]}) ; définir la position « maison » (2 décimales suffisent)`,
      );
    }
    const segments = planWeatherRequests(
      dates,
      (d) => {
        const p = phone.get(d);
        return p ? { position: p, source: "phone" } : { position: home as Position, source: "home" };
      },
      today,
    );

    // Tout est lu avant d'écrire : une requête en échec n'écrit rien.
    const rows: WeatherRow[] = [];
    for (const seg of segments) {
      if (requests > 0 && pauseMs > 0) await sleep(pauseMs);
      requests++;
      const days = await fetchWeather(seg, { fetch: opts.fetch, sleep });
      const wanted = new Set(seg.dates);
      for (const d of days) {
        if (!wanted.has(d.date)) continue;
        if (isEmptyWeather(d)) {
          empty++;
          continue;
        }
        rows.push({ ...d, weather: { lat: seg.lat, lon: seg.lon }, source: seg.source });
      }
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    firstWritten = rows[0]?.date ?? null;
    lastWritten = rows.at(-1)?.date ?? null;
    written = await upsertWeather(db.executor, rows);
  } catch (err) {
    const message = errorMessage(err).slice(0, 2000);
    await safeLogIngest(db, { source: WEATHER_SOURCE, days_count: 0, first_date: first, last_date: last, ok: false, error: message });
    throw new Error(`synchro météo en échec : ${message}`);
  }
  await safeLogIngest(db, { source: WEATHER_SOURCE, days_count: written, first_date: firstWritten, last_date: lastWritten, ok: true, error: null });
  return {
    source: WEATHER_SOURCE,
    days_requested: dates.length,
    days_written: written,
    days_empty: empty,
    requests,
    first_date: firstWritten,
    last_date: lastWritten,
  };
}

// ---------------------------------------------------------------------------
// Kp
// ---------------------------------------------------------------------------

export type SyncKpOptions = {
  from: string;
  to: string;
  /** Fuseau des journées locales. Défaut : CONTEXT_TZ. */
  tz?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  db?: Db;
};

export type SyncKpResult = {
  source: "kp";
  days_requested: number;
  days_written: number;
  first_date: string | null;
  last_date: string | null;
};

export async function syncKp(opts: SyncKpOptions): Promise<SyncKpResult> {
  const db = opts.db ?? getDb();
  let written = 0;
  let firstWritten: string | null = null;
  let lastWritten: string | null = null;
  let requested = 0;
  try {
    if (opts.from > opts.to) throw new Error(`plage Kp invalide : ${opts.from} → ${opts.to}`);
    const tz = opts.tz ?? contextTimeZone();
    const dates = dateRange(opts.from, opts.to);
    requested = dates.length;
    // Tranches de 3 h qui recouvrent la première et la dernière journée locale.
    const start = Math.floor(localDayBounds(opts.from, tz).start / BIN_MS) * BIN_MS;
    const end = localDayBounds(opts.to, tz).end - 1;
    const bins = await fetchKp(start, end, { fetch: opts.fetch, sleep: opts.sleep });
    const days = dailyKpMax(bins, dates, tz);
    firstWritten = days[0]?.date ?? null;
    lastWritten = days.at(-1)?.date ?? null;
    written = await upsertKp(db.executor, days);
  } catch (err) {
    const message = errorMessage(err).slice(0, 2000);
    await safeLogIngest(db, { source: KP_SOURCE, days_count: 0, first_date: opts.from, last_date: opts.to, ok: false, error: message });
    throw new Error(`synchro Kp en échec : ${message}`);
  }
  await safeLogIngest(db, { source: KP_SOURCE, days_count: written, first_date: firstWritten, last_date: lastWritten, ok: true, error: null });
  return { source: KP_SOURCE, days_requested: requested, days_written: written, first_date: firstWritten, last_date: lastWritten };
}

// ---------------------------------------------------------------------------
// Tâche context-sync
// ---------------------------------------------------------------------------

export type ContextSyncResult = {
  from: string;
  to: string;
  weather: SyncWeatherResult | { error: string };
  kp: SyncKpResult | { error: string };
};

export type ContextSyncOptions = Omit<SyncWeatherOptions, "dates" | "today"> & {
  now?: Date;
  tz?: string;
  days?: number;
};

/**
 * Tâche `context-sync` : les `days` (7) dernières journées **complètes** (hier
 * et avant, dans CONTEXT_TZ), plus les journées dont la position du téléphone
 * est arrivée après le calcul de leur météo. Météo et Kp sont indépendants :
 * l'échec de l'un n'empêche pas l'autre, mais la tâche échoue (500) si l'un échoue.
 */
export async function runContextSyncJob(opts: ContextSyncOptions = {}): Promise<ContextSyncResult> {
  const db = opts.db ?? getDb();
  const tz = opts.tz ?? contextTimeZone();
  const today = todayIn(tz, opts.now ?? new Date());
  const to = addDays(today, -1);
  const from = addDays(today, -(opts.days ?? 7));

  const errors: string[] = [];
  let weather: ContextSyncResult["weather"];
  try {
    const stale = await staleWeatherDates(db.executor, MAX_STALE_PER_RUN);
    weather = await syncWeather({ ...opts, db, today, dates: [...dateRange(from, to), ...stale.filter((d) => d < from)] });
  } catch (err) {
    weather = { error: errorMessage(err) };
    errors.push(weather.error);
  }
  let kp: ContextSyncResult["kp"];
  try {
    kp = await syncKp({ from, to, tz, db, fetch: opts.fetch, sleep: opts.sleep });
  } catch (err) {
    kp = { error: errorMessage(err) };
    errors.push(kp.error);
  }
  if (errors.length > 0) throw new Error(errors.join(" ; "));
  return { from, to, weather, kp };
}
