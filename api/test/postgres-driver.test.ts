/**
 * Chemin de production : le driver `postgres` (et non PGlite en direct), branché
 * sur PGlite via le protocole réseau Postgres (pglite-socket). Vérifie le parser
 * du type `date`, les scripts multi-instructions des migrations et les transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createDb, createPostgresClient, postgresExecutor, type Db } from "../src/db";
import { migrate } from "../src/migrate";
import { createApp } from "../src/app";
import { TEST_TOKEN } from "./helpers";

let pg: PGlite;
let server: PGLiteSocketServer;
let sql: ReturnType<typeof createPostgresClient>;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  const port = 55000 + Math.floor(Math.random() * 5000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  sql = createPostgresClient(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1, ssl: false });
  db = createDb(postgresExecutor(sql));
});

afterAll(async () => {
  await db?.close();
  await server?.stop();
  await pg?.close();
});

describe("driver postgres", () => {
  it("applique les migrations une seule fois", async () => {
    expect(await migrate(db.executor)).toEqual(["001_daily_metrics.sql"]);
    expect(await migrate(db.executor)).toEqual([]);
  });

  it("renvoie le type date sous forme de chaîne YYYY-MM-DD (OID 1082)", async () => {
    await db.upsertHealthDays([{ date: "2026-01-01", steps: 0, sleep_start: "2025-12-31T23:30:00+01:00" }]);
    const raw = await sql`SELECT date FROM daily_metrics WHERE date = ${"2026-01-01"}`;
    expect(raw[0]!.date).toBe("2026-01-01");
    expect(await db.getDay("2026-01-01")).toMatchObject({
      date: "2026-01-01",
      steps: 0,
      sleep_minutes: null,
      sleep_start: "2025-12-31T22:30:00.000Z",
    });
  });

  it("upsert partiel et commits séparés", async () => {
    await db.upsertCommits([{ date: "2026-01-01", commits: 3 }]);
    await db.upsertHealthDays([{ date: "2026-01-01", sleep_minutes: 420 }]);
    expect(await db.getDay("2026-01-01")).toMatchObject({ steps: 0, sleep_minutes: 420, commits: 3 });
    const n = await sql`SELECT count(*)::int AS n FROM daily_metrics`;
    expect(n[0]!.n).toBe(1);
  });

  it("annule la transaction si une journée échoue en base", async () => {
    // steps négatif contourné côté JS pour tester le rollback de la base (CHECK).
    const tx = db.executor.transaction(async (t) => {
      await t.query("INSERT INTO daily_metrics (date, steps) VALUES ($1, $2)", ["2026-01-02", 5]);
      await t.query("INSERT INTO daily_metrics (date, steps) VALUES ($1, $2)", ["2026-01-03", -5]);
    });
    await expect(tx).rejects.toThrow();
    expect(await db.getDay("2026-01-02")).toBeNull();
  });

  it("séquence POST puis GET de docs/API.md", async () => {
    const app = createApp({ db, ingestToken: TEST_TOKEN });
    const res = await app.request("/ingest/health", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        days: [{ date: "2026-09-23", steps: 8421, sleep_minutes: 412, sleep_start: "2026-09-22T23:48:00+02:00", sleep_end: "2026-09-23T06:40:00+02:00" }],
      }),
    });
    expect(await res.json()).toEqual({ upserted: 1 });
    const day = await (await app.request("/day/2026-09-23")).json();
    expect(day).toMatchObject({ date: "2026-09-23", steps: 8421, sleep_minutes: 412, commits: null });
    const log = await sql`SELECT source, ok, first_date FROM ingest_log`;
    expect([...log]).toEqual([{ source: "health", ok: true, first_date: "2026-09-23" }]);
  });
});
