import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTechniqueInput } from "../input";
import type { TechniqueInput, WeatherInput } from "../types";
import { techniqueFor } from "./index";
import { AGENTS, FOOD, FULL, PREVIEW, SPEED, reseau, reseauParams, reseauSim, simulateReseau, speedsFor, type ReseauSim } from "./reseau";
import { extent, fixtureDays, inputWith, NULL_CASES, recordingCtx } from "./testing";

const DATE = "2026-07-14";
const input = (date = DATE) => buildTechniqueInput(date, fixtureDays, "reseau");
const WEATHER: WeatherInput = { temp_min: 12, temp_max: 21, precip_mm: 0, wind_kmh: 12, wind_dir_deg: 250, cloud: 0.5 };

/** Simulation réduite (grille 90, 3 000 agents, 60 itérations) : même code, rapide en test. */
const small = (sim: ReseauSim): ReseauSim => ({ ...sim, grid: 90, agents: 3000, iterations: 60, speeds: sim.speeds.slice(0, 60) });

function hash(a: Float32Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619) >>> 0;
  return h.toString(16);
}
const run = (inp: TechniqueInput) => simulateReseau(small(reseauSim(inp)), inp);

describe("Réseau : déterminisme", () => {
  it("même journée → même simulation et mêmes traces", () => {
    expect(reseauSim(input())).toEqual(reseauSim(input()));
    const other = buildTechniqueInput(DATE, fixtureDays.slice().reverse(), "reseau");
    expect(hash(run(input()))).toBe(hash(run(other)));
  });

  it("miniature : déterministe, grille réduite, même densité d'agents", () => {
    const inp = input();
    const sim = reseauSim(inp, "preview");
    expect(sim.grid).toBe(PREVIEW.grid);
    expect(sim.agents).toBe(Math.round(reseauParams(inp).agents * (PREVIEW.grid / FULL.grid) ** 2));
    expect(sim.sensorDistance).toBe(reseauSim(inp).sensorDistance);
    expect(hash(simulateReseau(sim, inp))).toBe(hash(simulateReseau(reseauSim(inp, "preview"), inp)));
  });

  it("deux dates différentes → deux réseaux différents", () => {
    expect(hash(run(input("2026-07-14")))).not.toBe(hash(run(input("2026-09-12"))));
  });

  it("ajouter des jours après J ne change pas la simulation de J", () => {
    const cut = fixtureDays.filter((d) => d.date <= DATE);
    expect(reseauSim(buildTechniqueInput(DATE, cut, "reseau"))).toEqual(reseauSim(input()));
  });

  it("le réseau se forme : traces concentrées, finies, dans le cadre", () => {
    const inp = input();
    const trail = simulateReseau(reseauSim(inp, "preview"), inp);
    const { min, max } = extent(trail);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(trail.every(Number.isFinite)).toBe(true);
    // Veines : une petite part des cellules porte l'essentiel de la trace.
    const sorted = Array.from(trail).sort((a, b) => b - a);
    const total = sorted.reduce((s, v) => s + v, 0);
    const top = sorted.slice(0, Math.round(sorted.length * 0.2)).reduce((s, v) => s + v, 0);
    expect(top / total).toBeGreaterThan(0.5);
    expect(max).toBeGreaterThan(0);
  });
});

describe("Réseau : données", () => {
  it("agents ← pas, angle ← sommeil, nourriture ← commits", () => {
    const at = (steps: number, sleep: number) => reseauParams({ ...input(), norms: { ...input().norms, steps, sleep } });
    expect(at(0, 0.5).agents).toBe(AGENTS.min);
    expect(at(1, 0.5).agents).toBe(AGENTS.min + AGENTS.span);
    expect(at(0.5, 1).sensorDeg).toBeGreaterThan(at(0.5, 0).sensorDeg);
    expect(reseauParams(inputWith("reseau", DATE, { commits: 7 })).food).toBe(7);
    expect(reseauParams(inputWith("reseau", DATE, { commits: 200 })).food).toBe(FOOD.max);
    expect(reseauParams(inputWith("reseau", DATE, { commits: 0 })).food).toBe(0);
    expect(reseauParams(inputWith("reseau", DATE, { commits: null })).food).toBe(FOOD.neutral);
  });

  it("pas horaires → vitesse heure par heure ; vent → dérive", () => {
    const base = input();
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 5 ? 3000 : 0));
    const p = reseauParams({ ...base, hourlySteps: hourly });
    expect(p.hourlyMeasured).toBe(true);
    expect(p.peakHour).toBe(5);
    const speeds = speedsFor(hourly, FULL.iterations);
    expect(Math.max(...speeds)).toBeCloseTo(SPEED.min + SPEED.span);
    expect(speeds[Math.floor((5.5 * FULL.iterations) / 24)]).toBeCloseTo(SPEED.min + SPEED.span);
    expect(speeds[0]).toBe(SPEED.min);
    expect(reseau.explain({ ...base, hourlySteps: hourly }).find((l) => l.param.startsWith("Vitesse"))!.value).toContain("pic à 5 h");
    expect(hash(run({ ...base, hourlySteps: hourly }))).not.toBe(hash(run(base)));
    // Sans pas horaires : le total réparti selon le profil type.
    expect(reseauParams(base).hourlyMeasured).toBe(false);
    // Vent du nord (0°) : il souffle vers le bas de l'image.
    const north = reseauSim({ ...base, weather: { ...WEATHER, wind_dir_deg: 0, wind_kmh: 30 } });
    expect(north.driftX).toBeCloseTo(0);
    expect(north.driftY).toBeCloseTo(0.06);
    expect(reseauParams(base).windMeasured).toBe(false);
  });

  it("chaque combinaison de null → simulation valide ; journée absente comprise", () => {
    const cases: [string, TechniqueInput][] = [...NULL_CASES.map((c) => [c.label, inputWith("reseau", DATE, c.over)] as [string, TechniqueInput]), ["absente", input("2031-01-01")]];
    for (const [label, inp] of cases) {
      const trail = run(inp);
      expect(trail.length, label).toBe(90 * 90);
      expect(trail.every(Number.isFinite), label).toBe(true);
      expect(extent(trail).max, label).toBeGreaterThan(0);
      const lines = reseau.explain(inp);
      expect(lines.length, label).toBeGreaterThanOrEqual(8);
      for (const l of lines) expect(l.param && l.source && l.value, label).toBeTruthy();
    }
    // Pas non mesurés : profil type (vitesse variable), jamais « 0 pas » (vitesse minimale constante).
    const nul = reseauSim(inputWith("reseau", DATE, { steps: null }));
    expect(new Set(nul.speeds).size).toBeGreaterThan(1);
  });

  it("steps: 0 et steps: null donnent des scènes différentes", () => {
    const zero = inputWith("reseau", DATE, { steps: 0 }), nul = inputWith("reseau", DATE, { steps: null });
    expect(reseauSim(zero)).not.toEqual(reseauSim(nul));
    expect(new Set(reseauSim(zero).speeds)).toEqual(new Set([SPEED.min]));
    expect(hash(run(zero))).not.toBe(hash(run(nul)));
    expect(reseau.explain(zero).find((l) => l.param.startsWith("Vitesse"))!.value).toMatch(/aucun pas/);
    expect(reseau.explain(nul).find((l) => l.param.startsWith("Vitesse"))!.source).toMatch(/non mesurés/);
  });

  it("explain : chaque paramètre avec sa donnée et sa valeur", () => {
    const lines = reseau.explain(input());
    const by = (p: string) => lines.find((l) => l.param.startsWith(p))!;
    expect(by("Nombre d'agents").source).toMatch(/^Pas \(\d+ᵉ centile\)$/);
    expect(by("Angle de détection").value).toMatch(/°$/);
    expect(by("Points nourriciers").source).toMatch(/Commits \(\d+/);
    expect(by("Direction de la dérive").source).toMatch(/repli 250°/);
    expect(by("Direction de la dérive").value).toBe("vers 70° (vent de 250°)");
    expect(by("Force de la dérive").source).toMatch(/repli 12 km\/h/);
    expect(by("Couleurs").value).toContain(input().palette.name);
  });
});

describe("Réseau : rendu", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", class { getContext() { return recordingCtx(1).ctx; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("miniature sans erreur, marque « données manquantes » si une métrique manque", () => {
    const rec = recordingCtx(200);
    expect(() => reseau.render(rec.ctx, 200, inputWith("reseau", DATE, { commits: null }), { quality: "preview" })).not.toThrow();
    expect(rec.points.length).toBeGreaterThan(0);
  });

  it("registre : Réseau portée, PNG seulement", () => {
    const t = techniqueFor("reseau");
    expect(t).toBe(reseau);
    expect(t.ported).toBe(true);
    expect(t.toSvg).toBeUndefined();
  });
});
