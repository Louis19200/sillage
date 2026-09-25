import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DailyMetricsWithContext, RangeWithContextResponse } from "@sillage/shared";
import { createTestDb, resetTestDb, TEST_TOKEN } from "../../test/helpers";
import { createApp } from "../app";
import type { Db } from "../db";
import { listJobs } from "../jobs";
import {
  ARCHIVE_URL,
  DAILY_VARIABLES,
  FORECAST_URL,
  WeatherError,
  buildWeatherUrl,
  fetchWeather,
  parseDaily,
  type FetchLike,
} from "../collectors/weather/client";
import { GFZ_KP_URL, dailyKpMax, parseKp } from "../collectors/kp/client";
import { addDays, dateRange, localDayBounds, splitRange, todayIn } from "./dates";
import { backfillContext, CHUNK_DAYS } from "./backfill";
import { getContexts, staleWeatherDates, upsertLocations } from "./store";
import { homePosition, planWeatherRequests, runContextSyncJob, syncKp, syncWeather } from "./sync";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
/** Vraie structure d'une réponse Open-Meteo (archive, Paris, `timezone=auto`). */
const archive7 = fixture("../collectors/weather/fixtures/archive-paris-2019-07-05.json");
/** Vraie structure d'une réponse de l'API de prévision (jours passés). */
const forecast8 = fixture("../collectors/weather/fixtures/forecast-paris-2026-09-17.json");
/** Vraie structure d'une réponse du service JSON Kp du GFZ (tempête de mai 2024). */
const gfz = fixture("../collectors/kp/fixtures/gfz-kp-2024-05-09.json");

const HOME = { lat: 48.85, lon: 2.35 };
const TZ = "Europe/Paris";
/** Tâche du 25/09/2026 à 04:45 Paris (02:45 UTC, horaire de vercel.json). */
const NIGHT = new Date("2026-09-25T02:45:00Z");
const noSleep = async () => {};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type Call = { url: URL };
function fakeFetch(respond: (url: URL, index: number) => Response | Promise<Response>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string) => {
    const url = new URL(input);
    calls.push({ url });
    return respond(url, calls.length - 1);
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

/** Valeur déterministe d'une journée et d'un lieu (pour reconnaître la position utilisée). */
function tmaxFor(date: string, lat: number): number {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) % 997;
  return Math.round((10 + (h % 150) / 10 + lat / 100) * 10) / 10;
}

/** Réponse Open-Meteo simulée (structure de la fixture) pour la plage et le lieu demandés. */
function openMeteoFor(url: URL, emptyFrom?: string): unknown {
  const start = url.searchParams.get("start_date")!;
  const end = url.searchParams.get("end_date")!;
  const lat = Number(url.searchParams.get("latitude"));
  const time = dateRange(start, end);
  const empty = (d: string) => emptyFrom !== undefined && d >= emptyFrom;
  const col = (f: (d: string) => unknown) => time.map((d) => (empty(d) ? null : f(d)));
  return {
    ...archive7,
    latitude: lat,
    daily: {
      time,
      weather_code: col(() => 3),
      temperature_2m_max: col((d) => tmaxFor(d, lat)),
      temperature_2m_min: col(() => 9.46),
      precipitation_sum: col(() => 0),
      wind_speed_10m_max: col(() => 12.04),
      wind_direction_10m_dominant: col(() => 225),
      cloud_cover_mean: col(() => 50),
      sunshine_duration: col(() => 3600),
      sunrise: col((d) => `${d}T07:30`),
      sunset: col((d) => `${d}T19:45`),
    },
  };
}

/** Réponse GFZ simulée : toutes les tranches de 3 h de la plage, Kp déterministe. */
function gfzFor(url: URL): unknown {
  const start = Date.parse(url.searchParams.get("start")!);
  const end = Date.parse(url.searchParams.get("end")!);
  const datetime: string[] = [];
  const Kp: number[] = [];
  for (let t = start; t <= end; t += 3 * 3_600_000) {
    datetime.push(new Date(t).toISOString().replace(".000Z", "Z"));
    Kp.push(Math.round((((t / 3_600_000 / 3) % 27) / 3) * 1000) / 1000);
  }
  return { meta: gfz.meta, datetime, Kp, status: Kp.map(() => "def") };
}

/** Faux Open-Meteo + GFZ. */
function fakeServices(opts: { emptyFrom?: string; failArchiveFrom?: string } = {}) {
  return fakeFetch((url) => {
    if (url.origin + url.pathname === GFZ_KP_URL) return json(gfzFor(url));
    if (opts.failArchiveFrom && url.searchParams.get("start_date")! >= opts.failArchiveFrom) {
      return json({ error: true, reason: "Parameter 'latitude' 48.85 is invalid" }, 400);
    }
    return json(openMeteoFor(url, opts.emptyFrom));
  });
}

// ---------------------------------------------------------------------------

describe("dates locales", () => {
  it("aujourd'hui dans le fuseau local, pas en UTC", () => {
    expect(todayIn(TZ, new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25"); // 00:30 à Paris
    expect(todayIn("UTC", new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-24");
  });

  it("intervalle UTC d'une journée locale, changements d'heure compris", () => {
    const iso = (t: number) => new Date(t).toISOString();
    const winter = localDayBounds("2024-01-15", TZ);
    expect([iso(winter.start), iso(winter.end)]).toEqual(["2024-01-14T23:00:00.000Z", "2024-01-15T23:00:00.000Z"]);
    const summer = localDayBounds("2024-05-10", TZ);
    expect([iso(summer.start), iso(summer.end)]).toEqual(["2024-05-09T22:00:00.000Z", "2024-05-10T22:00:00.000Z"]);
    const spring = localDayBounds("2024-03-31", TZ); // passage à l'heure d'été : 23 h
    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    const autumn = localDayBounds("2024-10-27", TZ); // 25 h
    expect((autumn.end - autumn.start) / 3_600_000).toBe(25);
  });

  it("découpe l'historique en lots d'un an", () => {
    const chunks = splitRange("2019-07-05", "2026-09-24", CHUNK_DAYS);
    expect(chunks[0]).toEqual({ from: "2019-07-05", to: "2020-07-03" });
    expect(chunks.at(-1)!.to).toBe("2026-09-24");
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.from).toBe(addDays(chunks[i - 1]!.to, 1));
  });
});

describe("client Open-Meteo", () => {
  it("demande les variables quotidiennes exactes, timezone=auto, position à 2 décimales", () => {
    const url = new URL(buildWeatherUrl({ endpoint: "archive", lat: 48.85, lon: 2.35, start: "2019-07-05", end: "2019-07-11" }));
    expect(url.origin + url.pathname).toBe(ARCHIVE_URL);
    expect(url.searchParams.get("daily")!.split(",")).toEqual([...DAILY_VARIABLES]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: "48.85",
      longitude: "2.35",
      start_date: "2019-07-05",
      end_date: "2019-07-11",
      timezone: "auto",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
    });
    const f = new URL(buildWeatherUrl({ endpoint: "forecast", lat: -33.87, lon: 151.21, start: "2026-09-17", end: "2026-09-24" }));
    expect(f.origin + f.pathname).toBe(FORECAST_URL);
  });

  it("lit la fixture d'archive : jour local d'Open-Meteo, unités, null et 0 distincts", () => {
    const days = parseDaily(archive7);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: "2019-07-05",
      temp_min: 15.8,
      temp_max: 27.9,
      precip_mm: 0, // 0 mm reste 0
      wind_max_kmh: 14.8,
      wind_dir_deg: 38,
      cloud_mean: 21,
      sunshine_min: 840, // 50 400 s
      sunrise: "05:52", // heure locale du lieu
      sunset: "21:57",
      weather_code: 1,
    });
    expect(days[6]!.cloud_mean).toBeNull(); // absent reste null
    expect(days[5]).toMatchObject({ precip_mm: 7.4, weather_code: 63, sunshine_min: 156 });
    expect(parseDaily(forecast8).map((d) => d.date)).toEqual(dateRange("2026-09-17", "2026-09-24"));
  });

  it("rejette une réponse mal formée", () => {
    expect(() => parseDaily({})).toThrow(/daily absent/);
    const bad = structuredClone(archive7);
    bad.daily.cloud_cover_mean.pop();
    expect(() => parseDaily(bad)).toThrow(/cloud_cover_mean/);
    const bad2 = structuredClone(archive7);
    bad2.daily.temperature_2m_max[0] = "chaud";
    expect(() => parseDaily(bad2)).toThrow(/temperature_2m_max/);
  });

  it("400 : pas de nouvel essai, message clair sans coordonnées", async () => {
    const f = fakeFetch(() => json({ error: true, reason: "Latitude must be in range of -90 to 90°. Given: 48.8566." }, 400));
    const err = await fetchWeather({ endpoint: "archive", lat: 48.86, lon: 2.35, start: "2019-07-05", end: "2019-07-11" }, { fetch: f, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(WeatherError);
    expect(err.kind).toBe("bad_request");
    expect(err.message).toMatch(/Open-Meteo refuse la requête \(400, archive 2019-07-05 → 2019-07-11\)/);
    expect(err.message).not.toMatch(/48\.8|2\.35/);
    expect(f.calls).toHaveLength(1);
  });

  it("429 : attend puis réessaie (limite de débit)", async () => {
    const waits: number[] = [];
    const f = fakeFetch((_, i) => (i === 0 ? json({ error: true, reason: "Minutely API request limit exceeded" }, 429) : json(archive7)));
    const days = await fetchWeather(
      { endpoint: "archive", lat: 48.85, lon: 2.35, start: "2019-07-05", end: "2019-07-11" },
      { fetch: f, sleep: async (ms) => void waits.push(ms) },
    );
    expect(days).toHaveLength(7);
    expect(waits).toEqual([61_000]);
  });
});

describe("client Kp (GFZ)", () => {
  it("maximum par journée locale, jamais de journée incomplète", () => {
    const bins = parseKp(gfz);
    expect(bins).toHaveLength(32);
    const days = dailyKpMax(bins, dateRange("2024-05-09", "2024-05-12"), TZ);
    // 05-09 à Paris commence le 08 à 22:00 UTC : tranche 21-24 du 08 absente → non écrite.
    expect(days).toEqual([
      { date: "2024-05-10", kp_max: 9 },
      { date: "2024-05-11", kp_max: 9 },
      { date: "2024-05-12", kp_max: 6 },
    ]);
    // En UTC, la journée du 09 est complète.
    expect(dailyKpMax(bins, ["2024-05-09"], "UTC")).toEqual([{ date: "2024-05-09", kp_max: 3.333 }]);
  });

  it("ignore les tranches non publiées et rejette une réponse mal formée", () => {
    const partial = structuredClone(gfz);
    partial.Kp[31] = -1;
    partial.Kp[30] = null;
    expect(parseKp(partial)).toHaveLength(30);
    expect(dailyKpMax(parseKp(partial), ["2024-05-12"], TZ)).toEqual([]);
    expect(() => parseKp({ datetime: [], Kp: [1] })).toThrow(/longueurs/);
    expect(() => parseKp({ error: "x" })).toThrow(/réponse GFZ inattendue/);
  });
});

describe("position maison", () => {
  it("arrondie à 2 décimales, absente = null, erreurs claires sans la valeur", () => {
    expect(homePosition({ HOME_LAT: "48.856613", HOME_LON: "2.352222" })).toEqual({ lat: 48.86, lon: 2.35 });
    expect(homePosition({})).toBeNull();
    expect(() => homePosition({ HOME_LAT: "48.8" })).toThrow(/ensemble/);
    expect(() => homePosition({ HOME_LAT: "95.12345", HOME_LON: "2" })).toThrow(/HOME_LAT invalide/);
    expect(() => homePosition({ HOME_LAT: "95.12345", HOME_LON: "2" })).not.toThrow(/95/);
  });
});

// ---------------------------------------------------------------------------
// Base PGlite
// ---------------------------------------------------------------------------

let db: Db;
let app: Hono;
const errors: string[] = [];

beforeAll(async () => {
  ({ db } = await createTestDb());
  app = createApp({ db, ingestToken: TEST_TOKEN, logError: (m) => errors.push(m) });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetTestDb(db);
  await db.executor.exec("TRUNCATE daily_context");
  errors.length = 0;
});

async function rows() {
  return db.executor.query<Record<string, unknown> & { date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, lat::text, lon::text, location_source, weather_lat::text, weather_lon::text,
            temp_max::float8 AS temp_max, precip_mm::float8 AS precip_mm, kp_max::float8 AS kp_max, to_char(sunrise, 'HH24:MI') AS sunrise
     FROM daily_context ORDER BY date`,
  );
}
async function ingestLog() {
  return db.executor.query<{ source: string; days_count: number; first_date: string | null; last_date: string | null; ok: boolean; error: string | null }>(
    `SELECT source, days_count, to_char(first_date, 'YYYY-MM-DD') AS first_date, to_char(last_date, 'YYYY-MM-DD') AS last_date, ok, error
     FROM ingest_log ORDER BY id`,
  );
}

function postLocation(body: unknown, token: string | null = TEST_TOKEN, a: Hono = app) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return a.request("/ingest/location", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("POST /ingest/location", () => {
  it("arrondit à 2 décimales côté serveur, upsert idempotent, journal sans coordonnées", async () => {
    const body = { days: [{ date: "2026-09-23", lat: 48.856613, lon: 2.352222 }, { date: "2026-09-24", lat: 45.764043, lon: 4.835659 }] };
    const res = await postLocation(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 2 });
    expect((await postLocation(body)).status).toBe(200); // même envoi : pas de doublon

    const r = await rows();
    expect(r.map((x) => [x.date, x.lat, x.lon, x.location_source])).toEqual([
      ["2026-09-23", "48.86", "2.35", "phone"],
      ["2026-09-24", "45.76", "4.84", "phone"],
    ]);
    const log = await ingestLog();
    expect(log).toEqual([
      { source: "location", days_count: 2, first_date: "2026-09-23", last_date: "2026-09-24", ok: true, error: null },
      { source: "location", days_count: 2, first_date: "2026-09-23", last_date: "2026-09-24", ok: true, error: null },
    ]);
  });

  it("valide les bornes, refuse les champs inconnus, sans recopier les valeurs", async () => {
    for (const bad of [
      { days: [{ date: "2026-09-24", lat: 90.5, lon: 2.35 }] },
      { days: [{ date: "2026-09-24", lat: 48.85, lon: -180.01 }] },
      { days: [{ date: "2026-02-30", lat: 48.85, lon: 2.35 }] },
      { days: [{ date: "2026-09-24", lat: 48.85, lon: 2.35, accuracy_m: 4 }] },
      { days: [] },
    ]) {
      const res = await postLocation(bad);
      expect(res.status).toBe(400);
    }
    expect((await postLocation("{pas du json")).status).toBe(400);
    expect(await rows()).toEqual([]);
    const log = await ingestLog();
    expect(log.every((l) => !l.ok)).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/90\.5|180\.01|48\.85/);
  });

  it("exige INGEST_TOKEN (un jeton de lecture ne suffit pas)", async () => {
    const readToken = "r".repeat(32);
    const a = createApp({ db, ingestToken: TEST_TOKEN, readToken, protectReads: true });
    const body = { days: [{ date: "2026-09-24", lat: 48.85, lon: 2.35 }] };
    expect((await postLocation(body, null, a)).status).toBe(401);
    expect((await postLocation(body, readToken, a)).status).toBe(401);
    expect((await postLocation(body, TEST_TOKEN, a)).status).toBe(200);
  });
});

describe("syncWeather", () => {
  it("position du jour (téléphone) sinon maison, requêtes regroupées, jamais d'écrasement de la position du téléphone", async () => {
    await upsertLocations(db.executor, [
      { date: "2026-09-20", lat: 45.76, lon: 4.84 },
      { date: "2026-09-21", lat: 45.76, lon: 4.84 },
    ]);
    const f = fakeServices();
    const res = await syncWeather({ dates: dateRange("2026-09-18", "2026-09-24"), today: "2026-09-25", home: HOME, fetch: f, sleep: noSleep, db });

    // Maison 18-19, téléphone 20-21, maison 22-24 : trois requêtes à l'API de prévision.
    expect(f.calls.map((c) => [c.url.origin + c.url.pathname, c.url.searchParams.get("latitude"), c.url.searchParams.get("start_date"), c.url.searchParams.get("end_date")])).toEqual([
      [FORECAST_URL, "48.85", "2026-09-18", "2026-09-19"],
      [FORECAST_URL, "45.76", "2026-09-20", "2026-09-21"],
      [FORECAST_URL, "48.85", "2026-09-22", "2026-09-24"],
    ]);
    expect(res).toMatchObject({ source: "weather", days_requested: 7, days_written: 7, requests: 3, first_date: "2026-09-18", last_date: "2026-09-24" });

    const r = await rows();
    expect(r.map((x) => [x.date, x.location_source, x.lat, x.weather_lat])).toEqual([
      ["2026-09-18", "home", "48.85", "48.85"],
      ["2026-09-19", "home", "48.85", "48.85"],
      ["2026-09-20", "phone", "45.76", "45.76"],
      ["2026-09-21", "phone", "45.76", "45.76"],
      ["2026-09-22", "home", "48.85", "48.85"],
      ["2026-09-23", "home", "48.85", "48.85"],
      ["2026-09-24", "home", "48.85", "48.85"],
    ]);
    expect(r[2]!.temp_max).toBe(tmaxFor("2026-09-20", 45.76)); // météo de Lyon, pas de la maison
    expect(r[0]!.temp_max).toBe(tmaxFor("2026-09-18", 48.85));
    expect(r[0]!.precip_mm).toBe(0);
    expect(r[0]!.sunrise).toBe("07:30");
  });

  it("idempotent : relancer réécrit les mêmes valeurs, sans doublon", async () => {
    const opts = { dates: dateRange("2026-09-18", "2026-09-24"), today: "2026-09-25", home: HOME, sleep: noSleep, db };
    await syncWeather({ ...opts, fetch: fakeServices() });
    const first = await rows();
    await syncWeather({ ...opts, fetch: fakeServices() });
    expect(await rows()).toEqual(first);
    expect(first).toHaveLength(7);
  });

  it("archive pour le passé, prévision pour les 14 derniers jours", () => {
    const segs = planWeatherRequests(dateRange("2026-09-01", "2026-09-24"), () => ({ position: HOME, source: "home" }), "2026-09-25");
    expect(segs.map((s) => [s.endpoint, s.start, s.end])).toEqual([
      ["archive", "2026-09-01", "2026-09-10"],
      ["forecast", "2026-09-11", "2026-09-24"],
    ]);
  });

  it("journées vides (archive pas encore à jour) : non écrites, jamais transformées en 0", async () => {
    const res = await syncWeather({
      dates: dateRange("2026-08-01", "2026-08-10"),
      today: "2026-09-25",
      home: HOME,
      fetch: fakeServices({ emptyFrom: "2026-08-08" }),
      sleep: noSleep,
      db,
    });
    expect(res).toMatchObject({ days_written: 7, days_empty: 3, last_date: "2026-08-07" });
    expect((await rows()).map((x) => x.date)).toEqual(dateRange("2026-08-01", "2026-08-07"));
  });

  it("tout ou rien : une requête en échec n'écrit rien ; erreur journalisée sans coordonnées", async () => {
    await upsertLocations(db.executor, [{ date: "2026-08-05", lat: 43.3, lon: 5.37 }]);
    await expect(
      syncWeather({
        dates: dateRange("2026-08-01", "2026-08-10"),
        today: "2026-09-25",
        home: HOME,
        fetch: fakeServices({ failArchiveFrom: "2026-08-06" }),
        sleep: noSleep,
        db,
      }),
    ).rejects.toThrow(/synchro météo en échec : Open-Meteo refuse la requête \(400/);
    expect((await rows()).filter((x) => x.weather_lat !== null)).toEqual([]);
    const log = (await ingestLog()).at(-1)!;
    expect(log).toMatchObject({ source: "weather", ok: false, days_count: 0, first_date: "2026-08-01", last_date: "2026-08-10" });
    expect(log.error).not.toMatch(/48\.85|43\.3|5\.37/);
  });

  it("sans position maison : erreur claire pour les jours sans position du téléphone", async () => {
    await expect(
      syncWeather({ dates: ["2026-09-24"], today: "2026-09-25", home: null, fetch: fakeServices(), sleep: noSleep, db }),
    ).rejects.toThrow(/HOME_LAT \/ HOME_LON manquantes : 1 journée/);
  });
});

describe("syncKp", () => {
  it("écrit kp_max par journée locale sans toucher aux autres colonnes", async () => {
    await upsertLocations(db.executor, [{ date: "2024-05-10", lat: 45.76, lon: 4.84 }]);
    const f = fakeFetch(() => json(gfz));
    const res = await syncKp({ from: "2024-05-10", to: "2024-05-12", tz: TZ, fetch: f, db });
    expect(res).toMatchObject({ source: "kp", days_requested: 3, days_written: 3 });
    const u = f.calls[0]!.url;
    expect(u.origin + u.pathname).toBe(GFZ_KP_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({ start: "2024-05-09T21:00:00Z", end: "2024-05-12T21:59:59Z", index: "Kp" });
    const r = await rows();
    expect(r.map((x) => [x.date, x.kp_max, x.location_source, x.lat])).toEqual([
      ["2024-05-10", 9, "phone", "45.76"],
      ["2024-05-11", 9, null, null],
      ["2024-05-12", 6, null, null],
    ]);
    expect((await ingestLog()).at(-1)).toMatchObject({ source: "kp", ok: true, days_count: 3 });
  });
});

describe("tâche context-sync", () => {
  it("est enregistrée et planifiée sur Vercel", () => {
    expect(listJobs().map((j) => j.name)).toContain("context-sync");
    const vercel = fixture("../../vercel.json");
    expect(vercel.crons).toContainEqual({ path: "/cron/context-sync", schedule: "45 2 * * *" });
  });

  it("7 dernières journées complètes (météo + Kp) et journées dont la position a changé", async () => {
    const env = { HOME_LAT: process.env.HOME_LAT, HOME_LON: process.env.HOME_LON };
    process.env.HOME_LAT = "48.8534";
    process.env.HOME_LON = "2.3488";
    try {
      // Une journée ancienne calculée pour la maison, puis position du téléphone reçue après coup.
      await syncWeather({ dates: ["2026-08-15"], today: "2026-09-25", home: HOME, fetch: fakeServices(), sleep: noSleep, db });
      await upsertLocations(db.executor, [{ date: "2026-08-15", lat: 43.3, lon: 5.37 }]);
      expect(await staleWeatherDates(db.executor, 10)).toEqual(["2026-08-15"]);

      const f = fakeServices();
      const res = await runContextSyncJob({ now: NIGHT, tz: TZ, db, fetch: f, sleep: noSleep });
      expect(res.from).toBe("2026-09-18");
      expect(res.to).toBe("2026-09-24"); // aujourd'hui (25) exclu : journée en cours
      expect(res.weather).toMatchObject({ days_written: 8, requests: 2 });
      expect(res.kp).toMatchObject({ days_written: 7 });
      expect(await staleWeatherDates(db.executor, 10)).toEqual([]);

      const r = await rows();
      expect(r.find((x) => x.date === "2026-08-15")).toMatchObject({ location_source: "phone", weather_lat: "43.30" });
      expect(r.filter((x) => x.date >= "2026-09-18").map((x) => x.lat)).toEqual(Array(7).fill("48.85")); // HOME arrondie
      expect(r.filter((x) => x.date >= "2026-09-18").every((x) => x.kp_max !== null)).toBe(true);
      expect((await ingestLog()).map((l) => [l.source, l.ok])).toEqual([
        ["weather", true],
        ["weather", true],
        ["kp", true],
      ]);
    } finally {
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("météo et Kp indépendants : l'échec de l'un n'empêche pas l'autre, mais la tâche échoue", async () => {
    const f = fakeFetch((url) => (url.origin + url.pathname === GFZ_KP_URL ? json({}, 503) : json(openMeteoFor(url))));
    await expect(runContextSyncJob({ now: NIGHT, tz: TZ, db, home: HOME, fetch: f, sleep: noSleep })).rejects.toThrow(/synchro Kp en échec : erreur HTTP GFZ 503/);
    expect((await rows()).filter((x) => x.temp_max !== null)).toHaveLength(7);
    expect((await ingestLog()).map((l) => [l.source, l.ok])).toEqual([
      ["weather", true],
      ["kp", false],
    ]);
  });
});

describe("backfill par lots", () => {
  it("un an par lot, archive, depuis la première journée de daily_metrics", async () => {
    await db.upsertHealthDays([{ date: "2019-07-05", steps: 1200 }]);
    const f = fakeServices();
    const sleeps: number[] = [];
    const logs: string[] = [];
    const chunks = await backfillContext({
      to: "2021-07-10",
      tz: TZ,
      home: HOME,
      now: NIGHT,
      db,
      fetch: f,
      sleep: async (ms) => void sleeps.push(ms),
      log: (m) => logs.push(m),
    });
    expect(chunks.map((c) => [c.from, c.to])).toEqual([
      ["2019-07-05", "2020-07-03"],
      ["2020-07-04", "2021-07-03"],
      ["2021-07-04", "2021-07-10"],
    ]);
    const weatherCalls = f.calls.filter((c) => c.url.origin + c.url.pathname === ARCHIVE_URL);
    expect(weatherCalls).toHaveLength(3); // une requête d'archive par lot (même position)
    expect(f.calls.filter((c) => c.url.origin + c.url.pathname === GFZ_KP_URL)).toHaveLength(3);
    for (const c of weatherCalls) expect(dateRange(c.url.searchParams.get("start_date")!, c.url.searchParams.get("end_date")!).length).toBeLessThanOrEqual(366);
    expect(sleeps.filter((ms) => ms === 2_000)).toHaveLength(2); // pause entre les lots
    const r = await rows();
    expect(r).toHaveLength(dateRange("2019-07-05", "2021-07-10").length);
    expect(r[0]).toMatchObject({ date: "2019-07-05", location_source: "home" });
    expect(logs.at(-1)).toMatch(/terminé/);
    // Idempotent.
    await backfillContext({ to: "2021-07-10", tz: TZ, home: HOME, now: NIGHT, db, fetch: fakeServices(), sleep: noSleep, log: () => {} });
    expect(await rows()).toEqual(r);
  });

  it("un lot en échec : les précédents restent écrits, le message dit comment reprendre", async () => {
    await expect(
      backfillContext({
        from: "2019-07-05",
        to: "2021-07-10",
        only: "weather",
        tz: TZ,
        home: HOME,
        now: NIGHT,
        db,
        fetch: fakeServices({ failArchiveFrom: "2020-07-04" }),
        sleep: noSleep,
        log: () => {},
      }),
    ).rejects.toThrow(/lot 2\/3 \(2020-07-04 → 2021-07-03\)[\s\S]*--from 2020-07-04 --only weather/);
    const r = await rows();
    expect(r.at(-1)!.date).toBe("2020-07-03");
    expect(r).toHaveLength(365);
  });
});

describe("GET /day et GET /range : champ context", () => {
  async function seed() {
    await db.upsertHealthDays([
      { date: "2026-09-23", steps: 8421 },
      { date: "2026-09-24", steps: 0 },
    ]);
    await syncWeather({ dates: ["2026-09-23"], today: "2026-09-25", home: HOME, fetch: fakeServices(), sleep: noSleep, db });
    await syncKp({ from: "2026-09-23", to: "2026-09-23", tz: TZ, fetch: fakeServices(), db });
  }

  it("GET /day/:date : objet context, sans coordonnées", async () => {
    await seed();
    const res = await app.request("/day/2026-09-23");
    expect(res.status).toBe(200);
    const raw = await res.json();
    const day = DailyMetricsWithContext.parse(raw);
    expect(day.steps).toBe(8421);
    expect(day.context).toMatchObject({
      location_source: "home",
      temp_max: tmaxFor("2026-09-23", 48.85),
      temp_min: 9.5,
      precip_mm: 0,
      wind_max_kmh: 12,
      wind_dir_deg: 225,
      cloud_mean: 50,
      sunshine_min: 60,
      sunrise: "07:30",
      sunset: "19:45",
      weather_code: 3,
    });
    expect(typeof day.context!.kp_max).toBe("number");
    expect(JSON.stringify(raw)).not.toMatch(/"lat"|"lon"|48\.85/);
  });

  it("GET /day/:date sans contexte : context = null ; 404 inchangé", async () => {
    await seed();
    expect((await (await app.request("/day/2026-09-24")).json()).context).toBeNull();
    const notFound = await app.request("/day/2026-01-01");
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).not.toHaveProperty("context");
  });

  it("GET /range : un context par journée (ou null), jours non inventés", async () => {
    await seed();
    await syncWeather({ dates: ["2026-09-10"], today: "2026-09-25", home: HOME, fetch: fakeServices(), sleep: noSleep, db }); // contexte sans daily_metrics
    const res = await app.request("/range?from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const range = RangeWithContextResponse.parse(await res.json());
    expect(range.days.map((d) => [d.date, d.context === null])).toEqual([
      ["2026-09-23", false],
      ["2026-09-24", true],
    ]);
  });

  it("garde l'authentification et le CORS des routes de lecture", async () => {
    await seed();
    const readToken = "r".repeat(32);
    const origin = "https://sillage-art.vercel.app";
    const a = createApp({ db, ingestToken: TEST_TOKEN, readToken, protectReads: true, corsOrigins: [origin] });
    expect((await a.request("/range?from=2026-09-01&to=2026-09-30")).status).toBe(401);
    const res = await a.request("/range?from=2026-09-01&to=2026-09-30", { headers: { Authorization: `Bearer ${readToken}`, Origin: origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(RangeWithContextResponse.parse(await res.json()).days[0]!.context).not.toBeNull();
  });

  it("table de contexte vide : les routes répondent comme avant, plus context: null", async () => {
    await db.upsertHealthDays([{ date: "2026-09-23", steps: 1 }]);
    const body = await (await app.request("/range?from=2026-09-23&to=2026-09-23")).json();
    expect(body.days[0]).toMatchObject({ date: "2026-09-23", steps: 1, context: null });
    expect(errors).toEqual([]);
  });
});

it("getContexts ne renvoie jamais de coordonnées", async () => {
  await upsertLocations(db.executor, [{ date: "2026-09-24", lat: 45.76, lon: 4.84 }]);
  const ctx = (await getContexts(db.executor, "2026-09-24", "2026-09-24")).get("2026-09-24")!;
  expect(Object.keys(ctx)).not.toContain("lat");
  expect(ctx.location_source).toBe("phone");
  expect(ctx.temp_max).toBeNull();
});
