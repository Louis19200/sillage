import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTechniqueInput } from "../input";
import type { TechniqueInput, WeatherInput } from "../types";
import { techniqueFor } from "./index";
import { FULL, GERMS, PREVIEW, REGIMES, pelage, pelageParams, pelageSim, simulatePelage, type PelageSim } from "./pelage";
import { extent, fixtureDays, inputWith, NULL_CASES, recordingCtx } from "./testing";

const DATE = "2026-07-14";
const input = (date = DATE) => buildTechniqueInput(date, fixtureDays, "pelage");
const WEATHER: WeatherInput = { temp_min: 12, temp_max: 21, precip_mm: 0, wind_kmh: 12, wind_dir_deg: 250, cloud: 0.5 };

/** Simulation réduite (grille 72, itérations fixes) : même code, rapide en test. */
const small = (sim: PelageSim, iterations = 600): PelageSim => ({ ...sim, grid: 72, minIterations: iterations, maxIterations: iterations, settle: 0 });

function hash(a: Float32Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619) >>> 0;
  return h.toString(16);
}

describe("Pelage : déterminisme", () => {
  it("même journée → même simulation et même champ V", () => {
    expect(pelageSim(input())).toEqual(pelageSim(input()));
    const a = simulatePelage(small(pelageSim(input())));
    const b = simulatePelage(small(pelageSim(buildTechniqueInput(DATE, fixtureDays.slice().reverse(), "pelage"))));
    expect(hash(a.field)).toBe(hash(b.field));
    expect(a.iterations).toBe(600);
  });

  it("miniature : déterministe, grille réduite, itérations bornées", () => {
    const sim = pelageSim(input(), "preview");
    expect(sim.grid).toBe(PREVIEW.grid);
    const a = simulatePelage(sim), b = simulatePelage(pelageSim(input(), "preview"));
    expect(hash(a.field)).toBe(hash(b.field));
    expect(a.iterations).toBeLessThanOrEqual(PREVIEW.maxIterations);
    expect(a.iterations).toBeGreaterThanOrEqual(PREVIEW.minIterations);
    // Jusqu'à PREVIEW.maxGerms : mêmes germes au même endroit qu'en plein format (rayon réduit).
    const few = inputWith("pelage", DATE, { commits: 5 });
    expect(pelageSim(few, "preview").germs.map((g) => [g.x, g.y])).toEqual(pelageSim(few).germs.map((g) => [g.x, g.y]));
    expect(sim.germs.length).toBeLessThanOrEqual(PREVIEW.maxGerms);
  });

  it("deux dates différentes → deux simulations différentes", () => {
    const a = simulatePelage(small(pelageSim(input("2026-07-14"))));
    const b = simulatePelage(small(pelageSim(input("2026-09-12"))));
    expect(hash(a.field)).not.toBe(hash(b.field));
  });

  it("ajouter des jours après J ne change pas la simulation de J", () => {
    const cut = fixtureDays.filter((d) => d.date <= DATE);
    expect(pelageSim(buildTechniqueInput(DATE, cut, "pelage"))).toEqual(pelageSim(input()));
  });
});

describe("Pelage : données", () => {
  it("régime ← pas (4 régimes vérifiés, dans l'ordre)", () => {
    const at = (steps: number) => pelageParams({ ...input(), norms: { ...input().norms, steps } }).regime.name;
    expect([0.05, 0.3, 0.6, 0.95].map(at)).toEqual(REGIMES.map((r) => r.name));
    for (const r of REGIMES) expect(r).toMatchObject(({ labyrinthe: { F: 0.029, k: 0.057 }, vers: { F: 0.042, k: 0.063 }, corail: { F: 0.0545, k: 0.062 }, rayures: { F: 0.022, k: 0.051 } } as const)[r.name]);
    const p = pelageParams(input());
    expect(Math.abs(p.F - p.regime.F)).toBeLessThanOrEqual(0.00075);
    expect(Math.abs(p.k - p.regime.k)).toBeLessThanOrEqual(0.0005 + 1e-12);
  });

  it("miniature : chaque régime reste vivant et ne déborde pas, avec peu ou beaucoup de germes", () => {
    for (let r = 0; r < 4; r++) {
      for (const commits of [0, 34]) {
        const inp = inputWith("pelage", DATE, { commits });
        const base = pelageSim({ ...inp, weather: { ...WEATHER, precip_mm: commits ? 20 : 0 }, norms: { ...inp.norms, steps: r / 4 + 0.1 } }, "preview");
        const { field } = simulatePelage(base);
        const { min, max } = extent(field);
        const label = `${REGIMES[r]!.name}, ${commits} commits`;
        expect(max, label).toBeGreaterThan(0.2); // pas éteint
        expect(min, label).toBeLessThan(0.1); // pas une nappe uniforme
        expect(field.every(Number.isFinite), label).toBe(true);
      }
    }
  });

  it("germes ← commits ; pluie → plus de germes ; vent → anisotropie et axe", () => {
    expect(pelageParams(inputWith("pelage", DATE, { commits: 4 })).germs).toBe(4 + GERMS.base);
    expect(pelageParams(inputWith("pelage", DATE, { commits: 0 })).germs).toBe(GERMS.base);
    expect(pelageParams(inputWith("pelage", DATE, { commits: 500 })).germs).toBe(GERMS.max);
    const dry = { ...input(), weather: WEATHER };
    const wet = { ...input(), weather: { ...WEATHER, precip_mm: 4 } };
    expect(pelageParams(wet).rainGerms).toBe(8);
    expect(pelageSim(wet).germs.length).toBeGreaterThan(pelageSim(dry).germs.length);
    const windy = { ...input(), weather: { ...WEATHER, wind_kmh: 45, wind_dir_deg: 0 } };
    expect(pelageParams(windy).aniso).toBeGreaterThan(pelageParams(dry).aniso);
    // Vent du nord : étirement vertical (axe ±π/2 dans la grille).
    expect(Math.abs(Math.sin(pelageSim(windy).axis))).toBeCloseTo(1);
    expect(hash(simulatePelage(small(pelageSim(windy))).field)).not.toBe(hash(simulatePelage(small(pelageSim(dry))).field));
    // Sans météo : replis documentés.
    expect(pelageParams(input())).toMatchObject({ windMeasured: false, precipMeasured: false, rainGerms: 0 });
  });

  it("chaque combinaison de null → simulation valide ; journée absente comprise", () => {
    const cases: [string, TechniqueInput][] = [...NULL_CASES.map((c) => [c.label, inputWith("pelage", DATE, c.over)] as [string, TechniqueInput]), ["absente", input("2031-01-01")]];
    for (const [label, inp] of cases) {
      const { field } = simulatePelage(small(pelageSim(inp)));
      expect(field.length, label).toBe(72 * 72);
      expect(field.every(Number.isFinite), label).toBe(true);
      const lines = pelage.explain(inp);
      expect(lines.length, label).toBeGreaterThanOrEqual(8);
      for (const l of lines) expect(l.param && l.source && l.value, label).toBeTruthy();
    }
    expect(pelageParams(inputWith("pelage", DATE, { commits: null })).germs).toBe(GERMS.neutralCommits + GERMS.base);
    expect(pelageParams(inputWith("pelage", DATE, { commits: null })).germs).not.toBe(pelageParams(inputWith("pelage", DATE, { commits: 0 })).germs);
  });

  it("steps: 0 et steps: null donnent des scènes différentes", () => {
    const zero = pelageSim(inputWith("pelage", DATE, { steps: 0 }));
    const nul = pelageSim(inputWith("pelage", DATE, { steps: null }));
    expect(zero).not.toEqual(nul);
    expect(pelageParams(inputWith("pelage", DATE, { steps: 0 })).regime.name).toBe("labyrinthe");
    expect(pelageParams(inputWith("pelage", DATE, { steps: null })).regime.name).toBe("corail");
    expect(hash(simulatePelage(small(zero)).field)).not.toBe(hash(simulatePelage(small(nul)).field));
  });

  it("explain : chaque paramètre avec sa donnée et sa valeur", () => {
    const lines = pelage.explain(input());
    const by = (p: string) => lines.find((l) => l.param.startsWith(p))!;
    expect(by("Régime").source).toMatch(/^Pas \(\d+ᵉ centile\)$/);
    expect(by("Régime").value).toMatch(/F 0,0\d+, k 0,0\d+/);
    expect(by("Ajustement de k").source).toMatch(/Sommeil/);
    expect(by("Germes semés par les commits").source).toMatch(/Commits \(\d+\)/);
    expect(by("Germes semés par la pluie").source).toMatch(/repli/);
    expect(by("Axe d'étirement").source).toMatch(/repli 250°/);
    expect(by("Force de l'étirement").value).toMatch(/^0,\d+$/);
    expect(by("Couleurs").value).toContain(input().palette.name);
    const missing = pelage.explain(inputWith("pelage", DATE, { steps: null, commits: null }));
    expect(missing.find((l) => l.param.startsWith("Régime"))!.source).toMatch(/non mesuré → régime du milieu/);
    expect(missing.find((l) => l.param.startsWith("Germes semés par les commits"))!.source).toMatch(/non mesurés/);
  });
});

describe("Pelage : rendu", () => {
  beforeEach(() => {
    // Pas de canvas dans vitest : un OffscreenCanvas factice qui enregistre les appels.
    vi.stubGlobal("OffscreenCanvas", class { getContext() { return recordingCtx(1).ctx; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rendu plein format et miniature sans erreur, avec ou sans données", () => {
    const rec = recordingCtx(200);
    expect(() => pelage.render(rec.ctx, 200, inputWith("pelage", DATE, { steps: null, sleep_minutes: null, commits: null }), { quality: "preview" })).not.toThrow();
    expect(rec.points.length).toBeGreaterThan(0); // marque « données manquantes »
  });

  it("registre : Pelage portée, lourde (Worker), PNG seulement", () => {
    const t = techniqueFor("pelage");
    expect(t).toBe(pelage);
    expect(t.ported).toBe(true);
    expect(t.heavy).toBe(true);
    expect(t.toSvg).toBeUndefined();
    expect(FULL.grid).toBeGreaterThan(PREVIEW.grid);
  });
});
