import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DailyMetrics, HealthIngestBody, IsoDate } from "./index.ts";

test("IsoDate refuse les dates inexistantes", () => {
  assert.equal(IsoDate.safeParse("2026-09-24").success, true);
  assert.equal(IsoDate.safeParse("2026-02-30").success, false);
  assert.equal(IsoDate.safeParse("2026-9-24").success, false);
});

test("null et 0 restent distincts", () => {
  const body = HealthIngestBody.parse({ days: [{ date: "2026-09-24", steps: 0, sleep_minutes: null }] });
  assert.equal(body.days[0]?.steps, 0);
  assert.equal(body.days[0]?.sleep_minutes, null);
  assert.equal("sleep_start" in body.days[0]!, false);
});

test("les fixtures respectent le contrat", () => {
  const raw = JSON.parse(readFileSync(new URL("../fixtures/days.json", import.meta.url), "utf8"));
  for (const d of raw) DailyMetrics.parse(d);
  assert.ok(raw.length >= 60);
});

test("DailyMetrics : style et style_explain sont optionnels (ajout additif, moteur v2)", () => {
  const base = { date: "2026-09-23", steps: 1, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: 0, updated_at: "2026-09-24T06:00:00+02:00" };
  assert.equal(DailyMetrics.safeParse(base).success, true);
  const frozen = DailyMetrics.parse({
    ...base,
    style: "vitrail",
    style_explain: { selection_version: 1, style: "vitrail", frozen_at: "2026-09-26T03:30:00.000Z", engine_version: "v2", point: 3.2 },
  });
  assert.equal(frozen.style, "vitrail");
  assert.equal((frozen.style_explain as { point?: number }).point, 3.2); // le détail passe tel quel
  assert.equal(DailyMetrics.safeParse({ ...base, style: "aquarelle" }).success, false);
});
