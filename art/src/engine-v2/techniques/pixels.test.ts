import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { buildTechniqueInput, type DayV2 } from "../input";
import type { TechniqueInput } from "../types";
import { PIXELS, type PixelsStats, pixels, pixelsBuffer, pixelsParams, pixelsResolution } from "./pixels";
import { techniqueFor } from "./index";

const days = rawDays as unknown as DayV2[];
const DATE = "2026-06-28";
const R = 160;
const input = (date = DATE, history: readonly DayV2[] = days) => buildTechniqueInput(date, history, "pixels");
const withDay = (over: Partial<DayV2>, date = DATE) => input(date, days.map((d) => (d.date === date ? { ...d, ...over } : d)));

function hash(d: Uint8ClampedArray): string {
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 16777619) >>> 0;
  return h.toString(16);
}

function assertValid(d: Uint8ClampedArray, size: number, label: string): void {
  expect(d.length, label).toBe(size * size * 4);
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) throw new Error(`${label} : pixel transparent en ${i}`);
  // Pas une image unie.
  const seen = new Set<number>();
  for (let i = 0; i < d.length && seen.size < 8; i += 4 * 97) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
  expect(seen.size, label).toBeGreaterThan(3);
}

describe("Pixels : déterminisme", () => {
  it("même journée → même tampon", () => {
    expect(hash(pixelsBuffer(input(), R))).toBe(hash(pixelsBuffer(input(), R)));
    expect(hash(pixelsBuffer(buildTechniqueInput(DATE, days.slice().reverse(), "pixels"), R))).toBe(hash(pixelsBuffer(input(), R)));
  });

  it("deux dates différentes → deux images différentes", () => {
    expect(hash(pixelsBuffer(input("2026-06-28"), R))).not.toBe(hash(pixelsBuffer(input("2026-09-12"), R)));
  });

  it("ajouter des jours après J ne change pas l'image de J", () => {
    const cut = days.filter((d) => d.date <= DATE);
    expect(hash(pixelsBuffer(input(DATE, cut), R))).toBe(hash(pixelsBuffer(input(), R)));
  });

  it("résolution de calcul bornée (export, miniature)", () => {
    expect(pixelsResolution(1000)).toBe(1000);
    expect(pixelsResolution(4000)).toBe(2000);
    expect(pixelsResolution(1000, "preview")).toBe(400);
    expect(pixelsResolution(160, "preview")).toBe(160);
  });
});

describe("Pixels : données", () => {
  it("le glitch suit le manque de sommeil", () => {
    const short = pixelsParams(withDay({ sleep_minutes: 240 }));
    const long = pixelsParams(withDay({ sleep_minutes: 600 }));
    expect(short.glitch).toBeGreaterThan(0.9);
    expect(long.glitch).toBeLessThan(0.1);
    expect(short.threshold).toBeLessThan(long.threshold);
    expect(short.columns).toBeGreaterThan(long.columns);
    expect(short.maxShift).toBeGreaterThan(long.maxShift);
    expect(short.scanDark).toBeLessThan(long.scanDark);
    expect(short.tear).toBeGreaterThan(long.tear);
    // Sur l'image : une nuit courte fait couler bien plus de pixels et glisser plus de bandes.
    const ss: PixelsStats = {}, sl: PixelsStats = {};
    pixelsBuffer(withDay({ sleep_minutes: 240 }), R, ss);
    pixelsBuffer(withDay({ sleep_minutes: 600 }), R, sl);
    expect(ss.sortedShare!).toBeGreaterThan(sl.sortedShare! + 0.1);
    expect(ss.tornBands ?? 0).toBeGreaterThan(sl.tornBands ?? 0);
  });

  it("commits → blocs (3 par commit), vent → décalage RVB, pas horaires → bandes", () => {
    expect(pixelsParams(withDay({ commits: 4 })).blocks).toBe(4 * PIXELS.blocksPerCommit);
    expect(pixelsParams(withDay({ commits: 200 })).blocks).toBe(PIXELS.blocksMax);
    const base = input();
    const windy: TechniqueInput = { ...base, weather: { temp_min: null, temp_max: null, precip_mm: null, wind_kmh: 45, wind_dir_deg: 0, cloud: null } };
    const pw = pixelsParams(windy);
    expect(pw.rgbShift).toBeGreaterThan(pixelsParams(base).rgbShift);
    expect(pw.rgbDir[0]).toBeCloseTo(0);
    expect(pw.rgbDir[1]).toBeCloseTo(1); // vent du nord → souffle vers le bas de l'image
    expect(hash(pixelsBuffer(windy, R))).not.toBe(hash(pixelsBuffer(base, R)));
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 5 ? 3000 : 0));
    const ph = pixelsParams({ ...base, hourlySteps: hourly });
    expect(ph.hourlyMeasured).toBe(true);
    expect(pixels.explain({ ...base, hourlySteps: hourly }).find((l) => l.param.startsWith("Bandes"))!.value).toContain("5 h");
  });

  it("chaque combinaison de null donne une image valide ; journée absente comprise", () => {
    const cases: [string, TechniqueInput][] = [
      ["pas", withDay({ steps: null })],
      ["sommeil", withDay({ sleep_minutes: null, sleep_start: null, sleep_end: null })],
      ["commits", withDay({ commits: null })],
      ["tout", withDay({ steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null })],
      ["absente", input("2031-01-01")],
    ];
    for (const [label, inp] of cases) {
      assertValid(pixelsBuffer(inp, R), R, label);
      const lines = pixels.explain(inp);
      expect(lines.length).toBeGreaterThanOrEqual(8);
      for (const l of lines) expect(l.param && l.source && l.value, label).toBeTruthy();
    }
    expect(pixelsParams(cases[1]![1]).glitch).toBe(0.5);
    expect(pixelsParams(cases[2]![1]).blocks).toBe(0);
  });

  it("steps: 0 et steps: null donnent des images différentes", () => {
    expect(hash(pixelsBuffer(withDay({ steps: 0 }), R))).not.toBe(hash(pixelsBuffer(withDay({ steps: null }), R)));
  });

  it("explain : glitch, seuil, blocs, vent, chacun avec sa donnée", () => {
    const lines = pixels.explain(input());
    const by = (p: string) => lines.find((l) => l.param.startsWith(p))!;
    expect(by("Intensité du glitch").source).toMatch(/Manque de sommeil \(\d+ᵉ centile\)/);
    expect(by("Blocs déplacés").value).toMatch(/^\d+ /);
    expect(by("Décalage des canaux").source).toMatch(/repli/);
  });

  it("registre : Pixels portée, PNG seulement", () => {
    const t = techniqueFor("pixels");
    expect(t).toBe(pixels);
    expect(t.ported).toBe(true);
    expect(t.toSvg).toBeUndefined();
  });
});
