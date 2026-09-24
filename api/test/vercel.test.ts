/**
 * Déploiement serverless (Vercel + Neon) : CORS, token de lecture, routes /cron,
 * options du client `postgres`, variables d'environnement associées.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, depsFromEnv, type AppDeps } from "../src/app";
import {
  createPostgresClient,
  postgresClientOptions,
  SERVERLESS_POSTGRES_OPTIONS,
  type Db,
} from "../src/db";
import { EnvError, loadDatabaseConfig, loadEnv, parseCorsOrigins } from "../src/env";
import { clearJobs, hasJob, invokeJob, registerJob, UnknownJobError } from "../src/jobs";
import { createTestDb, resetTestDb, TEST_TOKEN } from "./helpers";

const READ_TOKEN = "r".repeat(16) + "fedcba9876543210"; // 32 caractères, ≠ TEST_TOKEN
const CRON_SECRET = "c".repeat(32);
const ART_ORIGIN = "https://sillage-art.vercel.app";
const DAY = { date: "2026-09-23", steps: 8421, sleep_minutes: 412 };

let db: Db;
const errors: string[] = [];

beforeAll(async () => {
  ({ db } = await createTestDb());
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetTestDb(db);
  errors.length = 0;
});

function makeApp(extra: Partial<AppDeps> = {}) {
  return createApp({ db, ingestToken: TEST_TOKEN, logError: (m) => errors.push(m), ...extra });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function ingest(app: ReturnType<typeof makeApp>, token: string) {
  return app.request("/ingest/health", {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ days: [DAY] }),
  });
}

// ---------------------------------------------------------------------------

describe("variables d'environnement", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost:5432/sillage", INGEST_TOKEN: TEST_TOKEN };

  it("READ_TOKEN : facultatif, 32 caractères minimum, différent d'INGEST_TOKEN", () => {
    expect(loadEnv(base).READ_TOKEN).toBeUndefined();
    expect(loadEnv({ ...base, READ_TOKEN: "" }).READ_TOKEN).toBeUndefined();
    expect(loadEnv({ ...base, READ_TOKEN }).READ_TOKEN).toBe(READ_TOKEN);
    expect(() => loadEnv({ ...base, READ_TOKEN: "x".repeat(31) })).toThrow(/READ_TOKEN.*32/);
    expect(() => loadEnv({ ...base, READ_TOKEN: TEST_TOKEN })).toThrow(/différent/);
  });

  it("CRON_SECRET : facultatif, 16 caractères minimum", () => {
    expect(loadEnv(base).CRON_SECRET).toBeUndefined();
    expect(loadEnv({ ...base, CRON_SECRET }).CRON_SECRET).toBe(CRON_SECRET);
    expect(() => loadEnv({ ...base, CRON_SECRET: "court" })).toThrow(EnvError);
  });

  it("CORS_ORIGINS : liste séparée par des virgules, vide = désactivé", () => {
    expect(loadEnv(base).CORS_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, CORS_ORIGINS: "" }).CORS_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, CORS_ORIGINS: ` ${ART_ORIGIN}/ , http://localhost:5173,,${ART_ORIGIN}` }).CORS_ORIGINS).toEqual([
      ART_ORIGIN,
      "http://localhost:5173",
    ]);
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(() => loadEnv({ ...base, CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...base, CORS_ORIGINS: "sillage-art.vercel.app" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...base, CORS_ORIGINS: `${ART_ORIGIN}/page` })).toThrow(/CORS_ORIGINS/);
  });

  it("DATABASE_SERVERLESS : faux par défaut", () => {
    expect(loadEnv(base).DATABASE_SERVERLESS).toBe(false);
    expect(loadEnv({ ...base, DATABASE_SERVERLESS: "true" }).DATABASE_SERVERLESS).toBe(true);
    expect(loadDatabaseConfig({ DATABASE_URL: base.DATABASE_URL })).toEqual({ url: base.DATABASE_URL, serverless: false });
    expect(loadDatabaseConfig({ DATABASE_URL: base.DATABASE_URL, DATABASE_SERVERLESS: "true" }).serverless).toBe(true);
    expect(() => loadDatabaseConfig({ DATABASE_URL: base.DATABASE_URL, DATABASE_SERVERLESS: "oui" })).toThrow(EnvError);
  });

  it("depsFromEnv transmet tokens, secret et origines à createApp", () => {
    const env = loadEnv({ ...base, READ_TOKEN, CRON_SECRET, CORS_ORIGINS: ART_ORIGIN, PROTECT_READS: "true" });
    expect(depsFromEnv(env, db)).toEqual({
      db,
      ingestToken: TEST_TOKEN,
      protectReads: true,
      readToken: READ_TOKEN,
      cronSecret: CRON_SECRET,
      corsOrigins: [ART_ORIGIN],
    });
    expect(depsFromEnv(loadEnv(base), db)).not.toHaveProperty("readToken");
    expect(depsFromEnv(loadEnv(base), db)).not.toHaveProperty("cronSecret");
  });
});

// ---------------------------------------------------------------------------

describe("CORS sur les routes de lecture", () => {
  const app = () => makeApp({ protectReads: true, readToken: READ_TOKEN, corsOrigins: [ART_ORIGIN, "http://localhost:5173"] });

  function preflight(a: ReturnType<typeof makeApp>, path: string, origin: string) {
    return a.request(path, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    });
  }

  it("preflight OPTIONS : 204, origine, méthodes et en-tête Authorization autorisés, sans token", async () => {
    for (const path of ["/range?from=2026-09-01&to=2026-09-30", "/day/2026-09-23"]) {
      const res = await preflight(app(), path, ART_ORIGIN);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ART_ORIGIN);
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("authorization");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Vary")).toContain("Origin");
    }
  });

  it("GET depuis une origine autorisée : en-tête CORS présent, y compris sur un 401", async () => {
    await ingest(app(), TEST_TOKEN);
    const ok = await app().request("/day/2026-09-23", { headers: { Origin: ART_ORIGIN, ...bearer(READ_TOKEN) } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ART_ORIGIN);

    const denied = await app().request("/day/2026-09-23", { headers: { Origin: ART_ORIGIN } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBe(ART_ORIGIN);
  });

  it("origine refusée : aucun Access-Control-Allow-Origin", async () => {
    const pre = await preflight(app(), "/range?from=2026-09-01&to=2026-09-30", "https://evil.example");
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const res = await app().request("/range?from=2026-09-01&to=2026-09-30", {
      headers: { Origin: "https://evil.example", ...bearer(READ_TOKEN) },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("pas de CORS sur les routes d'écriture ni sur /cron", async () => {
    const a = app();
    const pre = await preflight(a, "/ingest/health", ART_ORIGIN);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const res = await a.request("/ingest/health", {
      method: "POST",
      headers: { Origin: ART_ORIGIN, ...bearer(TEST_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ days: [DAY] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const cron = await preflight(a, "/cron/github-sync", ART_ORIGIN);
    expect(cron.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("CORS_ORIGINS vide : aucun en-tête CORS", async () => {
    const a = makeApp({ corsOrigins: [] });
    const pre = await preflight(a, "/day/2026-09-23", ART_ORIGIN);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const res = await a.request("/day/2026-09-23", { headers: { Origin: ART_ORIGIN } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("token de lecture (READ_TOKEN)", () => {
  const app = () => makeApp({ protectReads: true, readToken: READ_TOKEN });

  it("/day et /range acceptent READ_TOKEN et INGEST_TOKEN", async () => {
    await ingest(app(), TEST_TOKEN);
    for (const token of [READ_TOKEN, TEST_TOKEN]) {
      const day = await app().request("/day/2026-09-23", { headers: bearer(token) });
      expect(day.status).toBe(200);
      const range = await app().request("/range?from=2026-09-01&to=2026-09-30", { headers: bearer(token) });
      expect(range.status).toBe(200);
      expect((await range.json()).days).toHaveLength(1);
    }
  });

  it("/day et /range refusent l'absence de token ou un mauvais token", async () => {
    for (const headers of [{}, bearer("x".repeat(32)), bearer(READ_TOKEN + "x")]) {
      expect((await app().request("/day/2026-09-23", { headers })).status).toBe(401);
      expect((await app().request("/range?from=2026-09-01&to=2026-09-30", { headers })).status).toBe(401);
    }
  });

  it("READ_TOKEN est refusé en écriture (401, rien d'écrit, rien au journal)", async () => {
    const res = await ingest(app(), READ_TOKEN);
    expect(res.status).toBe(401);
    expect(await db.getDay(DAY.date)).toBeNull();
    const log = await db.executor.query("SELECT 1 FROM ingest_log");
    expect(log).toHaveLength(0);
    expect((await ingest(app(), TEST_TOKEN)).status).toBe(200);
  });

  it("READ_TOKEN est refusé sur /cron", async () => {
    const res = await makeApp({ readToken: READ_TOKEN, cronSecret: CRON_SECRET, jobs: { has: () => true, invoke: async () => 1 } }).request(
      "/cron/github-sync",
      { headers: bearer(READ_TOKEN) },
    );
    expect(res.status).toBe(401);
  });

  it("sans PROTECT_READS, la lecture reste publique", async () => {
    const res = await makeApp({ readToken: READ_TOKEN }).request("/range?from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
  });

  it("refuse un READ_TOKEN trop court à la construction", () => {
    expect(() => makeApp({ readToken: "court" })).toThrow(/32/);
  });
});

// ---------------------------------------------------------------------------

describe("GET /cron/:name", () => {
  beforeEach(() => clearJobs());
  afterEach(() => clearJobs());

  const cronApp = () => makeApp({ cronSecret: CRON_SECRET });
  const call = (app: ReturnType<typeof makeApp>, name: string, token: string | null = CRON_SECRET) =>
    app.request(`/cron/${name}`, { headers: token === null ? {} : bearer(token) });

  it("503 si CRON_SECRET n'est pas défini", async () => {
    registerJob("github-sync", "15 4 * * *", () => "ok");
    const res = await call(makeApp(), "github-sync");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "cron_disabled" });
  });

  it("401 sans token, avec un mauvais token ou avec INGEST_TOKEN", async () => {
    let ran = 0;
    registerJob("github-sync", "15 4 * * *", () => ran++);
    for (const token of [null, "x".repeat(32), CRON_SECRET + "x", TEST_TOKEN]) {
      const res = await call(cronApp(), "github-sync", token);
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
    expect(ran).toBe(0);
  });

  it("401 avant 404 : une tâche inconnue ne se révèle pas sans secret", async () => {
    expect((await call(cronApp(), "inconnue", null)).status).toBe(401);
  });

  it("404 si la tâche n'est pas enregistrée", async () => {
    const res = await call(cronApp(), "inconnue");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("200 : exécute la tâche du registre (registerJob) et renvoie durée et résultat", async () => {
    let ran = 0;
    registerJob("github-sync", "15 4 * * *", async () => {
      ran++;
      return { upserted: 7, from: "2026-09-17", to: "2026-09-23" };
    });
    const res = await call(cronApp(), "github-sync");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ job: "github-sync", ok: true, result: { upserted: 7, from: "2026-09-17", to: "2026-09-23" } });
    expect(typeof body.duration_ms).toBe("number");
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
    expect(ran).toBe(1);
  });

  it("200 : une tâche sans valeur de retour renvoie result: null", async () => {
    registerJob("vide", "0 * * * *", () => {});
    const body = await (await call(cronApp(), "vide")).json();
    expect(body).toMatchObject({ job: "vide", ok: true, result: null });
  });

  it("500 si la tâche lève, avec le message et la durée", async () => {
    registerJob("boom", "0 * * * *", async () => {
      throw new Error("GitHub injoignable");
    });
    const res = await call(cronApp(), "boom");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ job: "boom", ok: false, error: "GitHub injoignable" });
    expect(typeof body.duration_ms).toBe("number");
    expect(errors).toEqual(["cron boom : tâche en échec"]);
  });

  it("invokeJob propage la valeur et l'erreur ; tâche inconnue → UnknownJobError", async () => {
    registerJob("x", "0 * * * *", () => 42);
    expect(hasJob("x")).toBe(true);
    expect(hasJob("y")).toBe(false);
    expect(await invokeJob("x")).toBe(42);
    await expect(invokeJob("y")).rejects.toBeInstanceOf(UnknownJobError);
  });
});

// ---------------------------------------------------------------------------

describe("client postgres en serverless", () => {
  const url = "postgres://u:p@db.example.neon.tech:5432/sillage";

  it("DATABASE_SERVERLESS=true : max 1, sans requêtes préparées, timeouts courts", async () => {
    expect(postgresClientOptions(true)).toEqual(SERVERLESS_POSTGRES_OPTIONS);
    // Le client `postgres` ne se connecte qu'à la première requête : on inspecte ses options.
    const sql = createPostgresClient(url, postgresClientOptions(true));
    expect(sql.options.max).toBe(1);
    expect(sql.options.prepare).toBe(false);
    expect(sql.options.idle_timeout).toBe(5);
    expect(sql.options.connect_timeout).toBe(10);
    expect(sql.options.max_lifetime).toBe(300);
    await sql.end();
  });

  it("par défaut : comportement inchangé (pool de 5, requêtes préparées)", async () => {
    expect(postgresClientOptions(false)).toEqual({});
    const sql = createPostgresClient(url, postgresClientOptions(false));
    expect(sql.options.max).toBe(5);
    expect(sql.options.prepare).toBe(true);
    await sql.end();
  });

  it("le parser du type date (OID 1082) est conservé en serverless", async () => {
    const sql = createPostgresClient(url, postgresClientOptions(true));
    const parsers = sql.options.parsers as Record<number, (x: string) => unknown>;
    expect(parsers[1082]?.("2026-09-23")).toBe("2026-09-23");
    await sql.end();
  });
});
