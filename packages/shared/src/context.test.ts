import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DailyMetrics,
  DailyMetricsWithContext,
  DayContext,
  LocationIngestBody,
  RangeResponse,
  RangeWithContextResponse,
  SYNODIC_MONTH_DAYS,
  moonPhase,
  roundCoord,
} from "./index.ts";

/** Distance circulaire entre deux phases (0..1), en jours. */
const phaseDistanceDays = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d) * SYNODIC_MONTH_DAYS;
};

// Nouvelles et pleines lunes connues (éclipses et calendrier 2024, UTC).
const NEW_MOONS = ["2019-07-02", "2024-01-11", "2024-04-08", "2024-10-02", "2026-08-12"];
const FULL_MOONS = ["2019-07-16", "2024-04-23", "2024-09-18", "2025-03-14", "2025-09-07", "2026-03-03", "2026-08-28"];

test("moonPhase : nouvelles lunes connues", () => {
  for (const date of NEW_MOONS) {
    const m = moonPhase(date);
    assert.ok(phaseDistanceDays(m.phase, 0) < 0.75, `${date} : phase ${m.phase}`);
    assert.ok(m.illumination < 0.03, `${date} : illumination ${m.illumination}`);
  }
});

test("moonPhase : pleines lunes connues", () => {
  for (const date of FULL_MOONS) {
    const m = moonPhase(date);
    assert.ok(phaseDistanceDays(m.phase, 0.5) < 0.75, `${date} : phase ${m.phase}`);
    assert.ok(m.illumination > 0.97, `${date} : illumination ${m.illumination}`);
  }
});

test("moonPhase : premier quartier croissant, déterministe, bornes", () => {
  // Premier quartier du 2024-04-15 (19:13 UTC).
  const q = moonPhase("2024-04-15");
  assert.ok(Math.abs(q.phase - 0.25) < 0.03, `phase ${q.phase}`);
  assert.equal(q.waxing, true);
  assert.ok(Math.abs(q.illumination - 0.5) < 0.1);
  assert.deepEqual(moonPhase("2024-04-15"), q);
  for (let i = 0; i < 60; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const m = moonPhase(date);
    assert.ok(m.phase >= 0 && m.phase < 1);
    assert.ok(m.illumination >= 0 && m.illumination <= 1);
    assert.ok(m.age_days >= 0 && m.age_days < SYNODIC_MONTH_DAYS);
  }
  assert.throws(() => moonPhase("2026-02-30"), /date invalide/);
});

test("roundCoord : 2 décimales, jamais plus précis", () => {
  assert.equal(roundCoord(48.856613), 48.86);
  assert.equal(roundCoord(2.352222), 2.35);
  assert.equal(roundCoord(-0.001), 0);
  assert.equal(roundCoord(-122.419416), -122.42);
});

test("LocationIngestBody valide les bornes et refuse les champs inconnus", () => {
  assert.equal(LocationIngestBody.safeParse({ days: [{ date: "2026-09-24", lat: 48.8566, lon: 2.3522 }] }).success, true);
  assert.equal(LocationIngestBody.safeParse({ days: [{ date: "2026-09-24", lat: 91, lon: 0 }] }).success, false);
  assert.equal(LocationIngestBody.safeParse({ days: [{ date: "2026-09-24", lat: 0, lon: -181 }] }).success, false);
  assert.equal(LocationIngestBody.safeParse({ days: [{ date: "2026-09-24", lat: null, lon: 0 }] }).success, false);
  assert.equal(LocationIngestBody.safeParse({ days: [{ date: "2026-09-24", lat: 1, lon: 1, accuracy: 3 }] }).success, false);
  assert.equal(LocationIngestBody.safeParse({ days: [] }).success, false);
});

test("DailyMetricsWithContext reste compatible avec DailyMetrics", () => {
  const base = { date: "2026-09-24", steps: 0, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: 3, updated_at: "2026-09-24T06:00:00.000Z" };
  // Sans contexte : valide des deux côtés.
  assert.equal(DailyMetricsWithContext.safeParse(base).success, true);
  assert.equal(DailyMetricsWithContext.safeParse({ ...base, context: null }).success, true);
  // Un ancien client (DailyMetrics) ignore le champ en plus.
  const ctx = JSON.parse(readFileSync(new URL("../fixtures/context.json", import.meta.url), "utf8"))[0];
  const withCtx = { ...base, context: ctx };
  assert.equal(DailyMetrics.parse(withCtx).date, "2026-09-24");
  assert.equal(RangeResponse.safeParse({ from: "2026-09-24", to: "2026-09-24", days: [withCtx] }).success, true);
  assert.equal(RangeWithContextResponse.parse({ from: "2026-09-24", to: "2026-09-24", days: [withCtx] }).days[0]?.context?.updated_at, ctx.updated_at);
});

test("les fixtures de contexte respectent le contrat, avec des null et des vrais zéros", () => {
  const raw: Array<Record<string, unknown>> = JSON.parse(readFileSync(new URL("../fixtures/context.json", import.meta.url), "utf8"));
  assert.ok(raw.length >= 60);
  for (const c of raw) DayContext.parse(c);
  assert.ok(raw.some((c) => c.temp_max === null), "au moins une journée sans météo");
  assert.ok(raw.some((c) => c.kp_max === null), "au moins une journée sans Kp");
  assert.ok(raw.some((c) => c.precip_mm === 0), "au moins une journée sans pluie (0, pas null)");
  const days = JSON.parse(readFileSync(new URL("../fixtures/days.json", import.meta.url), "utf8"));
  assert.equal(raw.length, days.length, "une entrée de contexte par journée de days.json (même ordre)");
});
