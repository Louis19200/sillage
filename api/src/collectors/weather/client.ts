/**
 * Client Open-Meteo (gratuit, sans clé) : météo quotidienne d'un lieu.
 *
 * - Archive (`archive-api.open-meteo.com/v1/archive`, réanalyse ERA5 et suivantes,
 *   quelques jours de retard) pour le passé ; API de prévision
 *   (`api.open-meteo.com/v1/forecast`, jusqu'à 92 jours en arrière) pour les
 *   derniers jours. Même paramètres, même format de réponse.
 * - `timezone=auto` : Open-Meteo agrège sur le jour **local du lieu** et renvoie
 *   les dates `daily.time` dans ce fuseau ; on les reprend telles quelles, sans
 *   jamais les recalculer (paramètre obligatoire dès qu'on demande du `daily`).
 * - Aucune coordonnée dans les messages d'erreur ni dans les journaux : l'URL
 *   n'est jamais recopiée, et les nombres décimaux d'un message d'Open-Meteo
 *   sont masqués.
 */
import { IsoDate } from "@sillage/shared";

export const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** Variables quotidiennes demandées (noms exacts de la doc Open-Meteo). 10 au plus : au-delà, un appel compte double. */
export const DAILY_VARIABLES = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "cloud_cover_mean",
  "sunshine_duration",
  "sunrise",
  "sunset",
] as const;

/** Plage maximale d'une requête (un an, comme le découpage du backfill). */
export const MAX_SPAN_DAYS = 366;

export type WeatherEndpoint = "archive" | "forecast";

export type WeatherDay = {
  date: string;
  temp_min: number | null;
  temp_max: number | null;
  precip_mm: number | null;
  wind_max_kmh: number | null;
  wind_dir_deg: number | null;
  cloud_mean: number | null;
  sunshine_min: number | null;
  /** Heure locale du lieu, « HH:MM ». */
  sunrise: string | null;
  sunset: string | null;
  weather_code: number | null;
};

export const WEATHER_FIELDS = [
  "temp_min",
  "temp_max",
  "precip_mm",
  "wind_max_kmh",
  "wind_dir_deg",
  "cloud_mean",
  "sunshine_min",
  "sunrise",
  "sunset",
  "weather_code",
] as const satisfies readonly (keyof WeatherDay)[];

export type WeatherRequest = {
  endpoint: WeatherEndpoint;
  /** Coordonnées déjà arrondies à 2 décimales. */
  lat: number;
  lon: number;
  start: string;
  end: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WeatherErrorKind = "bad_request" | "rate_limit" | "http" | "invalid_response";

export class WeatherError extends Error {
  constructor(
    readonly kind: WeatherErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

/** Masque tout nombre décimal (coordonnées possibles) d'un texte venu d'Open-Meteo. */
export function redactNumbers(text: string): string {
  return text.replace(/-?\d+\.\d+/g, "…");
}

export function buildWeatherUrl(req: WeatherRequest): string {
  const base = req.endpoint === "archive" ? ARCHIVE_URL : FORECAST_URL;
  const params = new URLSearchParams({
    latitude: req.lat.toFixed(2),
    longitude: req.lon.toFixed(2),
    start_date: req.start,
    end_date: req.end,
    daily: DAILY_VARIABLES.join(","),
    timezone: "auto",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    timeformat: "iso8601",
  });
  return `${base}?${params.toString()}`;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function numberOrNull(v: unknown, what: string, date: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new WeatherError("invalid_response", `réponse Open-Meteo inattendue : ${what} = ${JSON.stringify(v)} le ${date}`);
  }
  return v;
}

/** « 2019-07-05T05:50 » (heure locale du lieu) → « 05:50 ». */
function localTimeOrNull(v: unknown, what: string, date: string): string | null {
  if (v === null || v === undefined) return null;
  const m = typeof v === "string" ? /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(v) : null;
  if (!m) throw new WeatherError("invalid_response", `réponse Open-Meteo inattendue : ${what} = ${JSON.stringify(v)} le ${date}`);
  return m[1]!;
}

const clampInt = (v: number | null, min: number, max: number) => (v === null ? null : Math.min(max, Math.max(min, Math.round(v))));

/**
 * Journées d'une réponse Open-Meteo (`daily`), converties aux unités stockées.
 * Les dates sont celles d'Open-Meteo (jour local du lieu). Une valeur absente
 * reste `null` (jamais 0) ; 0 mm de pluie reste 0.
 */
export function parseDaily(body: unknown): WeatherDay[] {
  const daily = (body as { daily?: Record<string, unknown> } | null)?.daily;
  if (!daily || typeof daily !== "object") throw new WeatherError("invalid_response", "réponse Open-Meteo inattendue : objet daily absent");
  const time = daily.time;
  if (!Array.isArray(time)) throw new WeatherError("invalid_response", "réponse Open-Meteo inattendue : daily.time absent");
  for (const v of DAILY_VARIABLES) {
    const col = daily[v];
    if (!Array.isArray(col) || col.length !== time.length) {
      throw new WeatherError("invalid_response", `réponse Open-Meteo inattendue : daily.${v} absent ou de longueur différente de daily.time`);
    }
  }
  const col = (v: (typeof DAILY_VARIABLES)[number], i: number) => (daily[v] as unknown[])[i];

  return time.map((date, i): WeatherDay => {
    if (typeof date !== "string" || !IsoDate.safeParse(date).success) {
      throw new WeatherError("invalid_response", `réponse Open-Meteo inattendue : date ${JSON.stringify(date)}`);
    }
    const tmin = numberOrNull(col("temperature_2m_min", i), "temperature_2m_min", date);
    const tmax = numberOrNull(col("temperature_2m_max", i), "temperature_2m_max", date);
    const precip = numberOrNull(col("precipitation_sum", i), "precipitation_sum", date);
    const wind = numberOrNull(col("wind_speed_10m_max", i), "wind_speed_10m_max", date);
    const sunshineS = numberOrNull(col("sunshine_duration", i), "sunshine_duration", date);
    return {
      date,
      temp_min: tmin === null ? null : round1(tmin),
      temp_max: tmax === null ? null : round1(tmax),
      precip_mm: precip === null ? null : Math.max(0, round1(precip)),
      wind_max_kmh: wind === null ? null : Math.max(0, round1(wind)),
      wind_dir_deg: clampInt(numberOrNull(col("wind_direction_10m_dominant", i), "wind_direction_10m_dominant", date), 0, 360),
      cloud_mean: clampInt(numberOrNull(col("cloud_cover_mean", i), "cloud_cover_mean", date), 0, 100),
      sunshine_min: sunshineS === null ? null : clampInt(sunshineS / 60, 0, 1440),
      sunrise: localTimeOrNull(col("sunrise", i), "sunrise", date),
      sunset: localTimeOrNull(col("sunset", i), "sunset", date),
      weather_code: clampInt(numberOrNull(col("weather_code", i), "weather_code", date), 0, 99),
    };
  });
}

/** Vrai si Open-Meteo n'a encore rien pour ce jour (archive pas encore à jour, par exemple). */
export function isEmptyWeather(d: WeatherDay): boolean {
  return WEATHER_FIELDS.every((k) => d[k] === null);
}

export type WeatherClientOptions = {
  fetch?: FetchLike;
  /** Attente avant un nouvel essai (429, 5xx, réseau). Injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Nouveaux essais après un 429 / 5xx / une erreur réseau (défaut 2). */
  retries?: number;
};

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readReason(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const reason = (JSON.parse(text) as { reason?: unknown }).reason;
      if (typeof reason === "string") return redactNumbers(reason).slice(0, 300);
    } catch {
      /* pas du JSON */
    }
    return redactNumbers(text).slice(0, 200);
  } catch {
    return "";
  }
}

function retryDelayMs(res: Response | null, attempt: number): number {
  const retry = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(retry) && retry > 0) return Math.min(retry, 120) * 1000;
  // Limite par minute d'Open-Meteo : on attend une minute pleine après un 429.
  return res?.status === 429 ? 61_000 : 5_000 * (attempt + 1);
}

const label = (req: WeatherRequest) => `${req.endpoint} ${req.start} → ${req.end}`;

/** Une requête Open-Meteo (au plus `MAX_SPAN_DAYS` jours), avec nouveaux essais. */
export async function fetchWeather(req: WeatherRequest, opts: WeatherClientOptions = {}): Promise<WeatherDay[]> {
  if (!IsoDate.safeParse(req.start).success || !IsoDate.safeParse(req.end).success || req.start > req.end) {
    throw new Error(`plage météo invalide : ${req.start} → ${req.end}`);
  }
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? 2;
  const url = buildWeatherUrl(req);

  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let failure: WeatherError | undefined;
    try {
      res = await doFetch(url, { headers: { Accept: "application/json", "User-Agent": "sillage-context-collector" } });
    } catch (err) {
      failure = new WeatherError("http", `Open-Meteo injoignable (${label(req)}) : ${redactNumbers(err instanceof Error ? err.message : String(err))}`);
    }
    if (res) {
      if (res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new WeatherError("invalid_response", `réponse Open-Meteo illisible (JSON invalide, ${label(req)})`, res.status);
        }
        return parseDaily(body);
      }
      const reason = await readReason(res);
      if (res.status === 429) {
        failure = new WeatherError("rate_limit", `limite de requêtes Open-Meteo atteinte (429, ${label(req)})${reason ? ` : ${reason}` : ""}`, 429);
      } else if (res.status >= 500) {
        failure = new WeatherError("http", `erreur HTTP Open-Meteo ${res.status} (${label(req)})${reason ? ` : ${reason}` : ""}`, res.status);
      } else {
        // 400 : paramètres refusés (variable inconnue, date hors archive…) : inutile de réessayer.
        throw new WeatherError("bad_request", `Open-Meteo refuse la requête (${res.status}, ${label(req)})${reason ? ` : ${reason}` : ""}`, res.status);
      }
    }
    if (attempt >= retries) throw failure ?? new WeatherError("http", `échec Open-Meteo (${label(req)})`);
    await sleep(retryDelayMs(res, attempt));
  }
}
