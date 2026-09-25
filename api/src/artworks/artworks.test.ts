import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, computeChain, DailyMetrics, familyOf, RangeResponse, type StyleId } from "@sillage/shared";
import { createApp } from "../app";
import type { Db } from "../db";
import { hasJob } from "../jobs";
import { createTestDb, resetTestDb, TEST_TOKEN } from "../../test/helpers";
import { ENGINE_VERSION, freezeStyles, getFrozen, runFreezeStylesJob, todayIn, toSelectionDay } from "./index";

type Fixture = { date: string; steps: number | null; sleep_minutes: number | null; sleep_start: string | null; sleep_end: string | null; commits: number | null };
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL("../../../packages/shared/fixtures/days.json", import.meta.url), "utf8"));
const FIRST = fixtures[0]!.date; // 2026-05-27
const LAST = fixtures.at(-1)!.date; // 2026-09-23
const TODAY = addDays(LAST, 1);

let db: Db;
const errors: string[] = [];

async function load(days: Fixture[] = fixtures): Promise<void> {
  await db.upsertHealthDays(days.map(({ date, steps, sleep_minutes, sleep_start, sleep_end }) => ({ date, steps, sleep_minutes, sleep_start, sleep_end })));
  await db.upsertCommits(days.filter((d) => d.commits !== null).map((d) => ({ date: d.date, commits: d.commits! })));
}

beforeAll(async () => {
  ({ db } = await createTestDb());
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetTestDb(db);
  await db.executor.exec("TRUNCATE artworks");
  errors.length = 0;
});

describe("migration 003", () => {
  it("crée la table artworks (date clé primaire)", async () => {
    const cols = await db.executor.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'artworks' ORDER BY ordinal_position",
    );
    expect(cols.map((c) => c.column_name)).toEqual(["date", "engine_version", "style", "selection_version", "explain", "frozen_at"]);
  });
});

describe("freeze-styles", () => {
  it("est enregistrée dans le registre des tâches", () => {
    expect(hasJob("freeze-styles")).toBe(true);
  });

  it("« aujourd'hui » se lit à Paris", () => {
    expect(todayIn("Europe/Paris", new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25");
    expect(todayIn("Europe/Paris", new Date("2026-09-24T21:30:00Z"))).toBe("2026-09-24");
  });

  it("fige tout l'historique jusqu'à aujourd'hui − 3, puis ne fait plus rien (idempotente)", async () => {
    await load();
    const first = await freezeStyles({ db, today: TODAY });
    expect(first).toMatchObject({ origin: FIRST, cutoff: addDays(TODAY, -3), frozen: 118, first: FIRST, last: addDays(TODAY, -3), already_frozen: 0 });
    const again = await freezeStyles({ db, today: TODAY });
    expect(again).toMatchObject({ frozen: 0, already_frozen: 118, first: null });
    const [{ n }] = (await db.executor.query<{ n: number }>("SELECT count(*)::int AS n FROM artworks")) as [{ n: number }];
    expect(n).toBe(118);

    // Le lendemain : un jour de plus.
    const next = await freezeStyles({ db, today: addDays(TODAY, 1) });
    expect(next).toMatchObject({ frozen: 1, first: addDays(TODAY, -2) });
  });

  it("donne les styles de la chaîne partagée (même calcul que le navigateur)", async () => {
    await load();
    await freezeStyles({ db, today: TODAY });
    const frozen = await getFrozen(db.executor, FIRST, LAST);
    const chain = computeChain({ days: (await db.getRange(FIRST, LAST)).map((d) => toSelectionDay(d)), to: addDays(TODAY, -3) });
    for (const e of chain.entries) {
      const a = frozen.get(e.date)!;
      expect(a.style).toBe(e.style);
      expect(a.engine_version).toBe(ENGINE_VERSION);
      expect(a.explain).toEqual(JSON.parse(JSON.stringify(e.explain)));
    }
    // Et le même calcul sur les fixtures brutes (réveil en +02:00 au lieu de l'UTC renvoyé par la base).
    const raw = computeChain({ days: fixtures, to: addDays(TODAY, -3) });
    expect(raw.entries.map((e) => e.style)).toEqual(chain.entries.map((e) => e.style));
  });

  it("un jour figé ne change plus, même si ses données changent", async () => {
    await load();
    await freezeStyles({ db, today: TODAY });
    const before = (await getFrozen(db.executor, "2026-07-14", "2026-07-14")).get("2026-07-14")!;
    await db.upsertHealthDays([{ date: "2026-07-14", steps: 99_999 }]);
    await freezeStyles({ db, today: addDays(TODAY, 5) });
    const after = (await getFrozen(db.executor, "2026-07-14", "2026-07-14")).get("2026-07-14")!;
    expect(after).toEqual(before);
  });

  it("fige aussi les jours absents de la base, et respecte le gel pour la suite", async () => {
    await load(fixtures.filter((d) => d.date !== "2026-07-01"));
    // Un style posé à la main avant le premier passage n'est jamais recalculé.
    await db.executor.query(
      "INSERT INTO artworks (date, engine_version, style, selection_version, explain) VALUES ('2026-06-10', 'v2', 'pixels', 1, '{}'::jsonb)",
    );
    await freezeStyles({ db, today: TODAY });
    const frozen = await getFrozen(db.executor, FIRST, LAST);
    expect(frozen.get("2026-07-01")!.explain).toMatchObject({ no_data: true, key: { mode: "day_index", K: 35 } });
    expect(frozen.get("2026-06-10")!.style).toBe("pixels");
    const next = frozen.get("2026-06-11")!;
    expect(familyOf(next.style)).not.toBe("numerique");
    expect((next.explain as { previous: unknown[] }).previous[0]).toEqual({ date: "2026-06-10", style: "pixels", frozen: true });
  });

  it("sans données : ne fait rien", async () => {
    expect(await freezeStyles({ db, today: TODAY })).toMatchObject({ origin: null, frozen: 0 });
  });
});

describe("intégration avec la météo (phase 8) et activation du gel", () => {
  it("toSelectionDay prend la météo du contexte en priorité", () => {
    const day = { date: "2026-07-14", steps: 1, sleep_minutes: 1, sleep_start: null, sleep_end: null, commits: 1, updated_at: "2026-07-15T00:00:00.000Z" };
    const ctx = { temp_max: 28.3, precip_mm: 1.8, wind_max_kmh: 22 } as Parameters<typeof toSelectionDay>[1];
    expect(toSelectionDay(day, ctx)).toMatchObject({ temp_max: 28.3, precip_mm: 1.8, wind_max_kmh: 22 });
    expect(toSelectionDay(day)).toMatchObject({ temp_max: undefined });
  });

  it("la tâche planifiée ne fige rien tant que FREEZE_STYLES n'est pas à true", async () => {
    const before = process.env.FREEZE_STYLES;
    delete process.env.FREEZE_STYLES;
    try {
      expect(await runFreezeStylesJob()).toMatchObject({ skipped: expect.stringContaining("FREEZE_STYLES") });
    } finally {
      if (before !== undefined) process.env.FREEZE_STYLES = before;
    }
  });
});

describe("GET /range et /day : style et style_explain des jours figés", () => {
  const app = () => createApp({ db, ingestToken: TEST_TOKEN, logError: (m) => errors.push(m) });

  it("ajoute style et style_explain aux jours figés seulement", async () => {
    await load();
    await freezeStyles({ db, today: TODAY });
    const res = await app().request(`/range?from=${addDays(LAST, -5)}&to=${LAST}`);
    expect(res.status).toBe(200);
    const body = RangeResponse.parse(await res.json());
    const cutoff = addDays(TODAY, -3);
    for (const d of body.days) {
      if (d.date <= cutoff) {
        expect(d.style).toBeDefined();
        expect(d.style_explain).toMatchObject({ style: d.style, selection_version: 1, engine_version: "v2" });
        expect(d.style_explain!.frozen_at).toMatch(/Z$/);
      } else {
        expect(d).not.toHaveProperty("style");
        expect(d).not.toHaveProperty("style_explain");
      }
    }

    const day = await app().request("/day/2026-07-14");
    const one = DailyMetrics.parse(await day.json());
    const frozen = (await getFrozen(db.executor, "2026-07-14", "2026-07-14")).get("2026-07-14")!;
    expect(one.style).toBe(frozen.style as StyleId);
    expect((one.style_explain as unknown as { candidates: unknown[] }).candidates).toHaveLength(10);

    const fresh = await app().request(`/day/${LAST}`);
    expect(await fresh.json()).not.toHaveProperty("style");
  });

  it("une panne de la table artworks ne casse pas la lecture", async () => {
    await load(fixtures.slice(0, 3));
    await db.executor.exec("ALTER TABLE artworks RENAME TO artworks_off");
    try {
      const res = await app().request(`/range?from=${FIRST}&to=${LAST}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { days: unknown[] }).days).toHaveLength(3);
      expect(errors).toContain("artworks : lecture des styles figés impossible");
    } finally {
      await db.executor.exec("ALTER TABLE artworks_off RENAME TO artworks");
    }
  });
});
