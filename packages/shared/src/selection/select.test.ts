import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays,
  BASE_WEIGHTS,
  bandOf,
  computeChain,
  familyOf,
  keyOf,
  selectDay,
  STYLES,
  STYLE_NAMES,
  wakeMinute,
  type SelectionDay,
  type StyleId,
} from "./index.ts";

const fixtures: SelectionDay[] = JSON.parse(readFileSync(new URL("../../fixtures/days.json", import.meta.url), "utf8"));
const last = fixtures.at(-1)!.date;

const pct = (value: number | null) => ({ value, basis: "percentile" as const, reference_size: 90 });
const day = (date: string, over: Partial<SelectionDay> = {}): SelectionDay => ({
  date, steps: 9000, sleep_minutes: 420, sleep_end: `${date}T07:30:00+02:00`, commits: 3, ...over,
});

test("minute du réveil : décalage explicite lu tel quel, UTC ramené à Paris", () => {
  assert.equal(wakeMinute("2026-07-14T07:57:00+02:00"), 477);
  assert.equal(wakeMinute("2026-07-14T05:57:00.000Z"), 477); // été : UTC+2
  assert.equal(wakeMinute("2026-01-14T06:57:00.000Z"), 477); // hiver : UTC+1
  assert.equal(wakeMinute(null), null);
  assert.equal(wakeMinute("n'importe quoi"), null);
});

test("nombre clé : formule exacte, absent compté 0, température en option", () => {
  const k = keyOf(day("2026-07-14", { steps: 12238, sleep_end: "2026-07-14T07:57:00+02:00", commits: 14 }), 5);
  assert.equal(k.mode, "data");
  assert.equal(k.K, 12238 * 1000 + 477 * 10 + 14);
  assert.equal(k.u, k.K * 0.6180339887498949 - Math.floor(k.K * 0.6180339887498949));
  const noWake = keyOf(day("2026-07-14", { steps: 100, sleep_end: null, commits: null }), 5);
  assert.equal(noWake.K, 100_000);
  const warm = keyOf(day("2026-07-14", { steps: 1, sleep_end: null, commits: 0, temp_max: 22.44 }), 5);
  assert.equal(warm.K, 1000 + 224 * 1e8);
  const empty = keyOf({ date: "2026-07-14", steps: null, sleep_minutes: null, sleep_end: null, commits: null }, 37);
  assert.deepEqual([empty.mode, empty.K], ["day_index", 37]);
  assert.equal(keyOf(null, 3).K, 3);
});

test("tranches de pas et pas absents → normale", () => {
  assert.equal(bandOf(0.1).id, "tres-calme");
  assert.equal(bandOf(0.2).id, "calme");
  assert.equal(bandOf(0.59).id, "normale");
  assert.equal(bandOf(0.79).id, "active");
  assert.equal(bandOf(0.8).id, "tres-active");
  assert.equal(bandOf(null).id, "normale");
});

test("la table des poids et les ajustements sont appliqués", () => {
  const e = selectDay({
    date: "2026-07-14",
    day: day("2026-07-14"),
    percentiles: { steps: pct(0.1), sleep: pct(0.1), commits: pct(0.9) },
    origin: "2026-07-01",
    previous: [],
  });
  assert.equal(e.band.id, "tres-calme");
  const w = Object.fromEntries(e.candidates.map((c) => [c.style, c.weight]));
  const b = BASE_WEIGHTS["tres-calme"];
  assert.equal(w.pixels, b.pixels * 6); // nuit courte
  assert.equal(w.attracteur, b.attracteur * 1.5);
  assert.equal(w.constructif, b.constructif * 1.5); // beaucoup de commits
  assert.equal(w.hachures, b.hachures * 1.5);
  assert.equal(w.harmonographe, b.harmonographe);
  assert.deepEqual(e.adjustments.map((a) => a.id), ["nuit-courte", "beaucoup-de-commits"]);
  const sum = e.candidates.reduce((s, c) => s + c.chance, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  // Le style tiré est celui dont l'intervalle contient le point.
  const chosen = e.candidates.find((c) => c.style === e.style)!;
  assert.ok(e.point >= chosen.from && e.point < chosen.to);
  assert.equal(e.point, e.key.u * e.total);
});

test("exclusions : hier, avant-hier et toute la famille d'hier", () => {
  const e = selectDay({
    date: "2026-07-14",
    day: day("2026-07-14"),
    percentiles: { steps: pct(0.5), sleep: pct(0.5), commits: pct(0.5) },
    origin: "2026-07-01",
    previous: [
      { date: "2026-07-13", style: "corail", frozen: false },
      { date: "2026-07-12", style: "vitrail", frozen: true },
    ],
  });
  const out = Object.fromEntries(e.exclusions.map((x) => [x.style, x.reason]));
  assert.deepEqual(out, { maree: "famille d'hier", pelage: "famille d'hier", corail: "hier", vitrail: "avant-hier", reseau: "famille d'hier" });
  for (const c of e.candidates) assert.equal(c.excluded, c.style in out);
  assert.ok(!(e.style in out));
});

test("nulls : aucune donnée, métriques manquantes, jour absent → style valide, jamais « absent = bas »", () => {
  const nulls = { steps: null, sleep_minutes: null, sleep_end: null, commits: null };
  const combos: Partial<SelectionDay>[] = [{ steps: null }, { sleep_minutes: null, sleep_end: null }, { commits: null }, nulls];
  for (const over of combos) {
    const days = fixtures.map((d) => (d.date === last ? { ...d, ...over } : d));
    const r = computeChain({ days, to: last, from: last });
    const e = r.entries[0]!.explain!;
    assert.ok(STYLES.includes(e.style));
    if (over.steps === null) assert.equal(e.band.id, "normale");
    if (over.commits === null) assert.ok(!e.adjustments.some((a) => a.metric === "commits"));
    if (over.sleep_minutes === null) assert.ok(e.missing_adjustments.some((a) => a.metric === "sleep"));
  }
  // Jour absent de la base, au milieu de la chaîne : K = numéro du jour.
  const gap = "2026-07-01";
  const r = computeChain({ days: fixtures.filter((d) => d.date !== gap), to: gap, from: gap, origin: fixtures[0]!.date });
  const e = r.entries[0]!.explain!;
  assert.equal(e.no_data, true);
  assert.equal(e.key.K, e.day_index);
  assert.equal(e.day_index, 35);
});

test("déterminisme : deux calculs identiques, ajouter l'avenir ne change pas le passé", () => {
  const a = computeChain({ days: fixtures, to: last });
  const b = computeChain({ days: fixtures.slice().reverse(), to: last });
  assert.deepEqual(a, b);
  const cut = "2026-08-01";
  const past = computeChain({ days: fixtures.filter((d) => d.date <= cut), to: cut, origin: fixtures[0]!.date });
  const full = a.entries.filter((e) => e.date <= cut);
  assert.deepEqual(past.entries, full);
});

test("chaîne : jamais le même style sur 3 jours, jamais la même famille 2 jours de suite", () => {
  const { entries } = computeChain({ days: fixtures, to: last });
  assert.equal(entries.length, fixtures.length);
  for (let i = 1; i < entries.length; i++) {
    assert.notEqual(familyOf(entries[i]!.style), familyOf(entries[i - 1]!.style), entries[i]!.date);
    if (i >= 2) assert.notEqual(entries[i]!.style, entries[i - 2]!.style, entries[i]!.date);
  }
});

test("gel : un style figé n'est jamais recalculé et pèse sur les jours suivants", () => {
  const free = computeChain({ days: fixtures, to: last });
  const target = free.entries[40]!;
  // Un style figé différent de celui qui serait calculé (et d'une autre famille que la veille).
  const prevFamily = familyOf(free.entries[39]!.style);
  const forced = STYLES.find((s) => s !== target.style && familyOf(s) !== prevFamily && s !== free.entries[38]!.style)!;
  const frozen = new Map<string, StyleId>([[target.date, forced]]);
  const r = computeChain({ days: fixtures, to: last, frozen });
  const e = r.entries[40]!;
  assert.deepEqual([e.style, e.frozen, e.explain], [forced, true, null]);
  const next = r.entries[41]!.explain!;
  assert.equal(next.previous[0]!.style, forced);
  assert.ok(next.exclusions.some((x) => x.style === forced && x.reason === "hier"));
  assert.notEqual(familyOf(next.style), familyOf(forced));
});

test("reprise derrière deux jours figés : même résultat qu'avec toute l'histoire", () => {
  const full = computeChain({ days: fixtures, to: last });
  const frozen = new Map<string, StyleId>(full.entries.slice(0, -3).map((e) => [e.date, e.style]));
  const window = fixtures.filter((d) => d.date >= addDays(last, -100));
  const r = computeChain({ days: window, to: last, from: addDays(last, -2), origin: fixtures[0]!.date, frozen });
  assert.equal(r.anchored, "frozen");
  assert.equal(r.start, addDays(last, -2));
  assert.deepEqual(r.entries.map((e) => e.style), full.entries.slice(-3).map((e) => e.style));
  // Seules les données de la fenêtre servent : les explications coïncident avec la chaîne complète.
  const same = computeChain({ days: fixtures, to: last, frozen });
  assert.deepEqual(r.entries, same.entries.slice(-3));
});

test("simulation sur les fixtures : fréquences des styles", () => {
  const { entries } = computeChain({ days: fixtures, to: last });
  const counts = new Map<StyleId, number>(STYLES.map((s) => [s, 0]));
  for (const e of entries) counts.set(e.style, counts.get(e.style)! + 1);
  const report = STYLES.map((s) => `${STYLE_NAMES[s].padEnd(14)} ${String(counts.get(s)).padStart(3)}  ${((100 * counts.get(s)!) / entries.length).toFixed(1).padStart(5)} %`);
  console.log(`\nSimulation sur ${entries.length} jours de fixtures :\n${report.join("\n")}`);
  // Au moins 7 techniques différentes sur 120 jours, aucune au-dessus de 35 %.
  assert.ok([...counts.values()].filter((n) => n > 0).length >= 7);
  assert.ok([...counts.values()].every((n) => n / entries.length < 0.35));
});

test("simulation longue (7 ans synthétiques, dont des trous) : règles tenues, calcul rapide", () => {
  const days: SelectionDay[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let d = "2019-07-05"; d <= "2026-09-24"; d = addDays(d, 1)) {
    if (rnd() < 0.05) continue; // jour absent
    const early = d < "2023-04-01";
    days.push({
      date: d,
      steps: rnd() < 0.03 ? null : Math.round(2000 + rnd() * 16000),
      sleep_minutes: early ? null : Math.round(300 + rnd() * 240),
      sleep_end: early ? null : `${d}T0${6 + Math.floor(rnd() * 3)}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00+02:00`,
      commits: rnd() < 0.3 ? 0 : Math.round(rnd() * 20),
    });
  }
  const t0 = performance.now();
  const { entries } = computeChain({ days, to: "2026-09-24" });
  const ms = performance.now() - t0;
  const counts = new Map<StyleId, number>(STYLES.map((s) => [s, 0]));
  for (let i = 0; i < entries.length; i++) {
    counts.set(entries[i]!.style, counts.get(entries[i]!.style)! + 1);
    if (i > 0) assert.notEqual(familyOf(entries[i]!.style), familyOf(entries[i - 1]!.style));
    if (i > 1) assert.notEqual(entries[i]!.style, entries[i - 2]!.style);
  }
  const report = STYLES.map((s) => `${STYLE_NAMES[s].padEnd(14)} ${String(counts.get(s)).padStart(4)}  ${((100 * counts.get(s)!) / entries.length).toFixed(1).padStart(5)} %`);
  console.log(`\nSimulation sur ${entries.length} jours synthétiques (${Math.round(ms)} ms) :\n${report.join("\n")}`);
  assert.ok(ms < 5000);
});
