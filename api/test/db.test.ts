import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DailyMetrics } from "@sillage/shared";
import { buildHealthUpsert, type Db } from "../src/db";
import { migrate } from "../src/migrate";
import { createTestDb, resetTestDb } from "./helpers";

let db: Db;

beforeAll(async () => {
  ({ db } = await createTestDb());
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetTestDb(db);
});

async function countRows(): Promise<number> {
  const rows = await db.executor.query<{ n: number }>("SELECT count(*)::int AS n FROM daily_metrics");
  return rows[0]!.n;
}

describe("migrate", () => {
  it("est idempotent et trace les migrations", async () => {
    expect(await migrate(db.executor)).toEqual([]);
    const rows = await db.executor.query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(rows.map((r) => r.name)).toEqual(["001_daily_metrics.sql"]);
  });
});

describe("upsertHealthDays", () => {
  it("renvoyer deux fois la même journée donne une seule ligne, mise à jour", async () => {
    await db.upsertHealthDays([{ date: "2026-09-23", steps: 1000, sleep_minutes: 400 }]);
    const first = await db.getDay("2026-09-23");
    await new Promise((r) => setTimeout(r, 5));
    await db.upsertHealthDays([{ date: "2026-09-23", steps: 8421, sleep_minutes: 412 }]);
    expect(await countRows()).toBe(1);
    const day = await db.getDay("2026-09-23");
    expect(day).toMatchObject({ steps: 8421, sleep_minutes: 412 });
    expect(Date.parse(day!.updated_at)).toBeGreaterThan(Date.parse(first!.updated_at));
  });

  it("0 reste 0, null reste null, un champ omis est inchangé", async () => {
    await db.upsertHealthDays([
      { date: "2026-09-20", steps: 0, sleep_minutes: null, sleep_start: "2026-09-19T23:00:00+02:00", sleep_end: "2026-09-20T07:00:00+02:00" },
    ]);
    let day = await db.getDay("2026-09-20");
    expect(day!.steps).toBe(0);
    expect(day!.sleep_minutes).toBeNull();

    // Seul steps est envoyé : le sommeil ne bouge pas.
    await db.upsertHealthDays([{ date: "2026-09-20", steps: 12 }]);
    day = await db.getDay("2026-09-20");
    expect(day).toMatchObject({ steps: 12, sleep_minutes: null });
    expect(day!.sleep_start).toBe("2026-09-19T21:00:00.000Z");
    expect(day!.sleep_end).toBe("2026-09-20T05:00:00.000Z");

    // null efface explicitement.
    await db.upsertHealthDays([{ date: "2026-09-20", sleep_start: null }]);
    day = await db.getDay("2026-09-20");
    expect(day).toMatchObject({ steps: 12, sleep_start: null, sleep_end: "2026-09-20T05:00:00.000Z" });
  });

  it("une journée neuve sans métrique crée des colonnes NULL, pas 0", async () => {
    await db.upsertHealthDays([{ date: "2026-09-21" }]);
    const day = await db.getDay("2026-09-21");
    expect(day).toMatchObject({ steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null });
  });

  it("n'écrit jamais commits", async () => {
    await db.upsertCommits([{ date: "2026-09-22", commits: 7 }]);
    await db.upsertHealthDays([{ date: "2026-09-22", steps: 3000 }]);
    expect(await db.getDay("2026-09-22")).toMatchObject({ steps: 3000, commits: 7 });
  });

  it("refuse une colonne étrangère (commits) glissée dans une journée santé", async () => {
    await expect(
      db.upsertHealthDays([{ date: "2026-09-22", commits: 3 } as unknown as { date: string }]),
    ).rejects.toThrow(/invalide/);
    expect(await countRows()).toBe(0);
  });

  it("est transactionnel : une journée invalide n'écrit rien", async () => {
    await expect(
      db.upsertHealthDays([{ date: "2026-09-22", steps: 1 }, { date: "2026-02-30", steps: 2 }]),
    ).rejects.toThrow();
    expect(await countRows()).toBe(0);
  });

  it("paramètre toutes les valeurs (aucune valeur dans le SQL)", () => {
    const { text, params } = buildHealthUpsert({ date: "2026-09-23", steps: 5, sleep_end: null });
    expect(text).toBe(
      "INSERT INTO daily_metrics (date, steps, sleep_end, updated_at) VALUES ($1, $2, $3, now()) " +
        "ON CONFLICT (date) DO UPDATE SET steps = EXCLUDED.steps, sleep_end = EXCLUDED.sleep_end, updated_at = now()",
    );
    expect(params).toEqual(["2026-09-23", 5, null]);
  });
});

describe("upsertCommits", () => {
  it("n'écrit que commits et ne duplique pas", async () => {
    await db.upsertHealthDays([{ date: "2026-09-23", steps: 8421, sleep_minutes: 412 }]);
    await db.upsertCommits([{ date: "2026-09-23", commits: 0 }]);
    await db.upsertCommits([{ date: "2026-09-23", commits: 4 }, { date: "2026-09-24", commits: 0 }]);
    expect(await countRows()).toBe(2);
    expect(await db.getDay("2026-09-23")).toMatchObject({ steps: 8421, sleep_minutes: 412, commits: 4 });
    expect(await db.getDay("2026-09-24")).toMatchObject({ steps: null, commits: 0 });
  });

  it("refuse une date ou un nombre invalide", async () => {
    await expect(db.upsertCommits([{ date: "2026-9-1", commits: 1 }])).rejects.toThrow(/date/);
    await expect(db.upsertCommits([{ date: "2026-09-01", commits: -1 }])).rejects.toThrow(/commits/);
  });
});

describe("lecture", () => {
  it("getDay renvoie une date YYYY-MM-DD exacte et un objet conforme au contrat", async () => {
    // Dates limites où un décalage de fuseau se verrait immédiatement.
    for (const date of ["2026-01-01", "2026-03-29", "2026-10-25", "2026-12-31"]) {
      await db.upsertHealthDays([{ date, steps: 1 }]);
      const day = await db.getDay(date);
      expect(day!.date).toBe(date);
      expect(DailyMetrics.safeParse(day).success).toBe(true);
    }
  });

  it("getDay renvoie null pour une journée absente", async () => {
    expect(await db.getDay("2020-01-01")).toBeNull();
  });

  it("getRange inclut les bornes et trie", async () => {
    await db.upsertHealthDays([
      { date: "2026-09-25", steps: 5 },
      { date: "2026-09-20", steps: 1 },
      { date: "2026-09-22", steps: 3 },
      { date: "2026-09-19", steps: 0 },
    ]);
    const days = await db.getRange("2026-09-20", "2026-09-25");
    expect(days.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-22", "2026-09-25"]);
  });
});

describe("logIngest", () => {
  it("écrit une ligne", async () => {
    await db.logIngest({ source: "github", days_count: 7, first_date: "2026-09-17", last_date: "2026-09-23", ok: true, error: null });
    const rows = await db.executor.query(
      "SELECT source, days_count, to_char(first_date, 'YYYY-MM-DD') AS first_date, to_char(last_date, 'YYYY-MM-DD') AS last_date, ok, error FROM ingest_log",
    );
    expect(rows).toEqual([
      { source: "github", days_count: 7, first_date: "2026-09-17", last_date: "2026-09-23", ok: true, error: null },
    ]);
  });
});
