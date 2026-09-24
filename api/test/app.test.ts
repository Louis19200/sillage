import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DailyMetrics, MAX_RANGE_DAYS, RangeResponse } from "@sillage/shared";
import { createApp, inclusiveDayCount } from "../src/app";
import type { Db } from "../src/db";
import { createTestDb, resetTestDb, TEST_TOKEN } from "./helpers";

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
  errors.length = 0;
});

function ingest(body: unknown, token: string | null = TEST_TOKEN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return app.request("/ingest/health", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function ingestLog() {
  return db.executor.query<{ source: string; days_count: number; first_date: string | null; last_date: string | null; ok: boolean; error: string | null }>(
    `SELECT source, days_count, to_char(first_date, 'YYYY-MM-DD') AS first_date,
            to_char(last_date, 'YYYY-MM-DD') AS last_date, ok, error
     FROM ingest_log ORDER BY id`,
  );
}

describe("séquence curl de docs/API.md", () => {
  it("POST /ingest/health puis GET /day/:date et GET /range", async () => {
    // Corps identique à l'exemple curl de docs/API.md.
    const res = await ingest({
      days: [
        {
          date: "2026-09-23",
          steps: 8421,
          sleep_minutes: 412,
          sleep_start: "2026-09-22T23:48:00+02:00",
          sleep_end: "2026-09-23T06:40:00+02:00",
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 1 });

    const dayRes = await app.request("/day/2026-09-23");
    expect(dayRes.status).toBe(200);
    const day = DailyMetrics.parse(await dayRes.json());
    expect(day).toMatchObject({
      date: "2026-09-23",
      steps: 8421,
      sleep_minutes: 412,
      commits: null,
    });
    expect(Date.parse(day.sleep_start!)).toBe(Date.parse("2026-09-22T23:48:00+02:00"));
    expect(Date.parse(day.sleep_end!)).toBe(Date.parse("2026-09-23T06:40:00+02:00"));

    const rangeRes = await app.request("/range?from=2026-09-01&to=2026-09-30");
    expect(rangeRes.status).toBe(200);
    const range = RangeResponse.parse(await rangeRes.json());
    expect(range.days.map((d) => d.date)).toEqual(["2026-09-23"]);

    expect(await ingestLog()).toEqual([
      { source: "health", days_count: 1, first_date: "2026-09-23", last_date: "2026-09-23", ok: true, error: null },
    ]);
  });
});

describe("POST /ingest/health", () => {
  it("renvoyer deux fois la même journée : une seule ligne, valeurs mises à jour", async () => {
    await ingest({ days: [{ date: "2026-09-23", steps: 100 }] });
    await ingest({ days: [{ date: "2026-09-23", steps: 200 }] });
    const rows = await db.executor.query("SELECT steps FROM daily_metrics");
    expect(rows).toEqual([{ steps: 200 }]);
  });

  it("steps: 0 reste 0, steps: null reste null, champ omis inchangé", async () => {
    await ingest({
      days: [
        { date: "2026-09-20", steps: 0, sleep_minutes: 300 },
        { date: "2026-09-21", steps: null, sleep_minutes: 400 },
      ],
    });
    // Deuxième envoi sans sleep_minutes : inchangé.
    await ingest({ days: [{ date: "2026-09-20", steps: 0 }, { date: "2026-09-21", steps: null }] });

    const d20 = await (await app.request("/day/2026-09-20")).json();
    const d21 = await (await app.request("/day/2026-09-21")).json();
    expect(d20).toMatchObject({ steps: 0, sleep_minutes: 300 });
    expect(d21).toMatchObject({ steps: null, sleep_minutes: 400 });
  });

  it("ne touche pas commits", async () => {
    await db.upsertCommits([{ date: "2026-09-23", commits: 5 }]);
    // Même si le client envoie commits, il est ignoré.
    const res = await ingest({ days: [{ date: "2026-09-23", steps: 10, commits: 99 }] });
    expect(res.status).toBe(200);
    const day = await (await app.request("/day/2026-09-23")).json();
    expect(day).toMatchObject({ steps: 10, commits: 5 });
  });

  it("401 sans token", async () => {
    const res = await ingest({ days: [{ date: "2026-09-23", steps: 1 }] }, null);
    expect(res.status).toBe(401);
    expect(await db.getDay("2026-09-23")).toBeNull();
  });

  it("401 avec un mauvais token", async () => {
    for (const token of ["mauvais", TEST_TOKEN.slice(0, -1) + "x", TEST_TOKEN + "x", ""]) {
      const res = await ingest({ days: [{ date: "2026-09-23", steps: 1 }] }, token);
      expect(res.status).toBe(401);
    }
    const res = await app.request("/ingest/health", {
      method: "POST",
      headers: { Authorization: `Basic ${TEST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-09-23" }] }),
    });
    expect(res.status).toBe(401);
    expect(await db.getDay("2026-09-23")).toBeNull();
  });

  it("400 lisible sur un corps invalide, et trace l'échec", async () => {
    const res = await ingest({ days: [{ date: "2026-02-30", steps: -1 }] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: string; message: string }[] };
    expect(body.error).toBe("bad_request");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "days.0.date" }),
        expect.objectContaining({ path: "days.0.steps" }),
      ]),
    );
    const log = await ingestLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ source: "health", days_count: 1, ok: false });
    expect(log[0]!.error).toMatch(/days\.0\.date/);
  });

  it("400 sur JSON illisible, liste vide ou trop longue", async () => {
    expect((await ingest("{pas du json")).status).toBe(400);
    expect((await ingest({ days: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 401 }, () => ({ date: "2026-09-23", steps: 1 }));
    expect((await ingest({ days: tooMany })).status).toBe(400);
    expect((await ingest({ days: [{ date: "2026-09-23", steps: 1.5 }] })).status).toBe(400);
    expect((await ingest({ days: [{ date: "2026-09-23", sleep_start: "2026-09-23T06:40:00" }] })).status).toBe(400);
    const log = await ingestLog();
    expect(log).toHaveLength(5);
    expect(log.every((l) => !l.ok)).toBe(true);
  });

  it("trace first_date / last_date sur un backfill désordonné", async () => {
    const res = await ingest({ days: [{ date: "2026-09-10", steps: 1 }, { date: "2026-08-30", steps: 2 }, { date: "2026-09-02" }] });
    expect(await res.json()).toEqual({ upserted: 3 });
    expect((await ingestLog())[0]).toMatchObject({ days_count: 3, first_date: "2026-08-30", last_date: "2026-09-10", ok: true });
  });

  it("500 et ligne ok=false si la base refuse l'écriture", async () => {
    const failing: Db = { ...db, upsertHealthDays: async () => { throw new Error("base indisponible"); } };
    const failingApp = createApp({ db: failing, ingestToken: TEST_TOKEN, logError: (m) => errors.push(m) });
    const res = await failingApp.request("/ingest/health", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ date: "2026-09-23", steps: 1 }] }),
    });
    expect(res.status).toBe(500);
    expect((await ingestLog())[0]).toMatchObject({ ok: false, error: "base indisponible", first_date: "2026-09-23" });
  });
});

describe("GET /day/:date", () => {
  it("404 si absente, 400 si invalide", async () => {
    expect((await app.request("/day/2026-09-23")).status).toBe(404);
    expect((await app.request("/day/2026-9-23")).status).toBe(400);
    expect((await app.request("/day/2026-02-29")).status).toBe(400);
    expect((await app.request("/day/hier")).status).toBe(400);
  });
});

describe("GET /range", () => {
  beforeEach(async () => {
    await db.upsertHealthDays([
      { date: "2026-09-19", steps: 1 },
      { date: "2026-09-20", steps: 2 },
      { date: "2026-09-22", steps: 3 },
      { date: "2026-09-25", steps: 4 },
      { date: "2026-09-26", steps: 5 },
    ]);
  });

  it("bornes incluses, jours absents non inventés, tri par date", async () => {
    const res = await app.request("/range?from=2026-09-20&to=2026-09-25");
    expect(res.status).toBe(200);
    const body = RangeResponse.parse(await res.json());
    expect(body.from).toBe("2026-09-20");
    expect(body.to).toBe("2026-09-25");
    expect(body.days.map((d) => [d.date, d.steps])).toEqual([
      ["2026-09-20", 2],
      ["2026-09-22", 3],
      ["2026-09-25", 4],
    ]);
  });

  it("from == to : un seul jour", async () => {
    const body = RangeResponse.parse(await (await app.request("/range?from=2026-09-22&to=2026-09-22")).json());
    expect(body.days.map((d) => d.date)).toEqual(["2026-09-22"]);
  });

  it("from > to → 400", async () => {
    const res = await app.request("/range?from=2026-09-25&to=2026-09-20");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/from/);
  });

  it(`plage de plus de ${MAX_RANGE_DAYS} jours → 400, exactement ${MAX_RANGE_DAYS} → 200`, async () => {
    // 2024-01-01 + 799 jours = 2026-03-10 (800 jours bornes incluses)
    expect(inclusiveDayCount("2024-01-01", "2026-03-10")).toBe(MAX_RANGE_DAYS);
    expect((await app.request("/range?from=2024-01-01&to=2026-03-10")).status).toBe(200);
    const res = await app.request("/range?from=2024-01-01&to=2026-03-11");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/trop longue/);
  });

  it("paramètres manquants ou invalides → 400", async () => {
    expect((await app.request("/range")).status).toBe(400);
    expect((await app.request("/range?from=2026-09-20")).status).toBe(400);
    expect((await app.request("/range?from=2026-09-20&to=2026-13-01")).status).toBe(400);
  });
});

describe("lecture protégée", () => {
  it("exige le token quand protectReads est activé", async () => {
    const protectedApp = createApp({ db, ingestToken: TEST_TOKEN, protectReads: true });
    await db.upsertHealthDays([{ date: "2026-09-23", steps: 1 }]);
    expect((await protectedApp.request("/day/2026-09-23")).status).toBe(401);
    expect((await protectedApp.request("/range?from=2026-09-01&to=2026-09-30")).status).toBe(401);
    const ok = await protectedApp.request("/day/2026-09-23", { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });
    expect(ok.status).toBe(200);
  });
});

describe("routes inconnues", () => {
  it("404 JSON", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
