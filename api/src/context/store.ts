/**
 * Accès à la table `daily_context` (migration 004). Chaque source n'écrit que
 * ses colonnes :
 *  - `upsertLocations` (téléphone)  : lat, lon, location_source = 'phone' ;
 *  - `upsertWeather` (Open-Meteo)   : colonnes météo + weather_lat/weather_lon, et
 *                                     la position « maison » seulement si le téléphone
 *                                     n'a rien envoyé pour ce jour ;
 *  - `upsertKp` (GFZ)               : kp_max.
 * Upsert sur `date` ; les noms de colonnes viennent de listes fixes, les valeurs
 * passent toujours en paramètres.
 */
import { IsoDate, roundCoord, type DayContext } from "@sillage/shared";
import type { Row, SqlExecutor } from "../db";
import { WEATHER_FIELDS, type WeatherDay } from "../collectors/weather/client";
import type { KpDay } from "../collectors/kp/client";

export type Position = { lat: number; lon: number };
export type LocationRow = { date: string } & Position;
export type WeatherRow = WeatherDay & {
  /** Position utilisée pour cette météo (arrondie). */
  weather: Position;
  /** Provenance de cette position. */
  source: "phone" | "home";
};

/** Lignes par INSERT multi-lignes (reste loin de la limite de 65 535 paramètres). */
const BATCH = 200;

function assertDate(date: string): void {
  if (!IsoDate.safeParse(date).success) throw new Error(`date invalide : ${JSON.stringify(date)} (attendu YYYY-MM-DD)`);
}

function assertPosition(p: Position, what: string): void {
  if (!Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90 || !Number.isFinite(p.lon) || p.lon < -180 || p.lon > 180) {
    throw new Error(`${what} : coordonnées hors bornes`);
  }
  if (roundCoord(p.lat) !== p.lat || roundCoord(p.lon) !== p.lon) throw new Error(`${what} : coordonnées non arrondies à 2 décimales`);
}

/** Dernière valeur par date (comme des upserts successifs) : un INSERT ne peut toucher deux fois la même ligne. */
function lastByDate<T extends { date: string }>(rows: readonly T[]): T[] {
  return [...new Map(rows.map((r) => [r.date, r])).values()];
}

async function insertBatches(
  ex: SqlExecutor,
  columns: readonly string[],
  rows: readonly unknown[][],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + BATCH).map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${[...ph, "now()"].join(", ")})`;
    });
    await ex.query(
      `INSERT INTO daily_context (${[...columns, "updated_at"].join(", ")}) VALUES ${values.join(", ")}
       ON CONFLICT (date) DO UPDATE SET ${onConflict}, updated_at = now()`,
      params,
    );
  }
}

/** Positions envoyées par le téléphone (déjà arrondies). Une transaction. */
export async function upsertLocations(ex: SqlExecutor, rows: readonly LocationRow[]): Promise<number> {
  for (const r of rows) {
    assertDate(r.date);
    assertPosition(r, `position du ${r.date}`);
  }
  await ex.transaction((tx) =>
    insertBatches(
      tx,
      ["date", "lat", "lon", "location_source"],
      lastByDate(rows).map((r) => [r.date, r.lat, r.lon, "phone"]),
      "lat = EXCLUDED.lat, lon = EXCLUDED.lon, location_source = EXCLUDED.location_source",
    ),
  );
  return rows.length;
}

/** Positions « téléphone » connues sur [from, to]. */
export async function getPhonePositions(ex: SqlExecutor, from: string, to: string): Promise<Map<string, Position>> {
  assertDate(from);
  assertDate(to);
  const rows = await ex.query<{ date: string; lat: unknown; lon: unknown }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, lat, lon FROM daily_context
     WHERE date BETWEEN $1 AND $2 AND location_source = 'phone' AND lat IS NOT NULL AND lon IS NOT NULL`,
    [from, to],
  );
  return new Map(rows.map((r) => [r.date, { lat: Number(r.lat), lon: Number(r.lon) }]));
}

/**
 * Journées dont la météo a été calculée pour une autre position que celle du
 * jour (position du téléphone arrivée après coup), les plus récentes d'abord.
 */
export async function staleWeatherDates(ex: SqlExecutor, limit: number): Promise<string[]> {
  const rows = await ex.query<{ date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM daily_context
     WHERE location_source = 'phone' AND weather_lat IS NOT NULL
       AND (weather_lat <> lat OR weather_lon <> lon)
     ORDER BY date DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.date).sort();
}

const WEATHER_COLUMNS = ["weather_lat", "weather_lon", ...WEATHER_FIELDS] as const;

/**
 * Météo de plusieurs journées, en une transaction. La position du jour
 * (lat/lon/location_source) n'est écrite que si elle ne vient pas du téléphone :
 * une position « maison » ne remplace jamais une position envoyée par le téléphone.
 */
export async function upsertWeather(ex: SqlExecutor, rows: readonly WeatherRow[]): Promise<number> {
  for (const r of rows) {
    assertDate(r.date);
    assertPosition(r.weather, `météo du ${r.date}`);
  }
  const keep = (col: string) =>
    `${col} = CASE WHEN daily_context.location_source = 'phone' THEN daily_context.${col} ELSE EXCLUDED.${col} END`;
  await ex.transaction((tx) =>
    insertBatches(
      tx,
      ["date", "lat", "lon", "location_source", ...WEATHER_COLUMNS],
      lastByDate(rows).map((r) => [
        r.date,
        r.weather.lat,
        r.weather.lon,
        r.source,
        r.weather.lat,
        r.weather.lon,
        ...WEATHER_FIELDS.map((f) => r[f]),
      ]),
      [keep("lat"), keep("lon"), keep("location_source"), ...WEATHER_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`)].join(", "),
    ),
  );
  return rows.length;
}

/** Kp maximal par journée, en une transaction. */
export async function upsertKp(ex: SqlExecutor, rows: readonly KpDay[]): Promise<number> {
  for (const r of rows) {
    assertDate(r.date);
    if (!Number.isFinite(r.kp_max) || r.kp_max < 0 || r.kp_max > 9) throw new Error(`kp_max invalide le ${r.date} : ${r.kp_max}`);
  }
  await ex.transaction((tx) =>
    insertBatches(tx, ["date", "kp_max"], lastByDate(rows).map((r) => [r.date, r.kp_max]), "kp_max = EXCLUDED.kp_max"),
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Lecture (champ `context` de GET /day et GET /range)
// ---------------------------------------------------------------------------

const SELECT_CONTEXT = `
  SELECT to_char(date, 'YYYY-MM-DD') AS date, location_source,
         temp_min, temp_max, precip_mm, wind_max_kmh, wind_dir_deg, cloud_mean, sunshine_min,
         to_char(sunrise, 'HH24:MI') AS sunrise, to_char(sunset, 'HH24:MI') AS sunset,
         weather_code, kp_max, updated_at
  FROM daily_context`;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function rowToContext(r: Row): DayContext {
  const updated = r.updated_at instanceof Date ? r.updated_at : new Date(String(r.updated_at));
  return {
    location_source: r.location_source === "phone" || r.location_source === "home" ? r.location_source : null,
    temp_min: num(r.temp_min),
    temp_max: num(r.temp_max),
    precip_mm: num(r.precip_mm),
    wind_max_kmh: num(r.wind_max_kmh),
    wind_dir_deg: num(r.wind_dir_deg),
    cloud_mean: num(r.cloud_mean),
    sunshine_min: num(r.sunshine_min),
    sunrise: typeof r.sunrise === "string" ? r.sunrise : null,
    sunset: typeof r.sunset === "string" ? r.sunset : null,
    weather_code: num(r.weather_code),
    kp_max: num(r.kp_max),
    updated_at: updated.toISOString(),
  };
}

/** Contexte stocké des journées de [from, to] (sans coordonnées). */
export async function getContexts(ex: SqlExecutor, from: string, to: string): Promise<Map<string, DayContext>> {
  assertDate(from);
  assertDate(to);
  const rows = await ex.query(`${SELECT_CONTEXT} WHERE date BETWEEN $1 AND $2 ORDER BY date`, [from, to]);
  return new Map(rows.map((r) => [String(r.date), rowToContext(r)]));
}

/** Première journée de `daily_metrics` (début du backfill), `null` si la table est vide. */
export async function firstMetricsDate(ex: SqlExecutor): Promise<string | null> {
  const rows = await ex.query<{ first: string | null }>("SELECT to_char(min(date), 'YYYY-MM-DD') AS first FROM daily_metrics");
  return rows[0]?.first ?? null;
}
