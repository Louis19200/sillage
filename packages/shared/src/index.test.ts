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
