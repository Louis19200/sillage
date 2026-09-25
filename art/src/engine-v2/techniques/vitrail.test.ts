import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { moonPhase } from "@sillage/shared";
import { Resvg } from "@resvg/resvg-js";
import { mulberry32 } from "../../engine/random";
import { buildTechniqueInput, type DayV2 } from "../input";
import type { TechniqueInput } from "../types";
import { expectWellFormedXml, mockCtx } from "./test-utils";
import { vitrail, vitrailPlan } from "./vitrail";
import { interiorEdges, polygonArea, voronoiCells, type Pt } from "./voronoi";

const days = rawDays as unknown as DayV2[];
const DATES = ["2026-06-29", "2026-07-01", "2026-07-14", "2026-07-22", "2026-08-26"];
const input = (date: string, history: readonly DayV2[] = days) => buildTechniqueInput(date, history, "vitrail");
const withDay = (date: string, patch: Partial<DayV2>) => days.map((d) => (d.date === date ? { ...d, ...patch } : d));

/** Cellules convexes, dans le cadre, qui pavent exactement le cadre ; chaque point appartient à la cellule du site le plus proche. */
function expectTiling(sites: readonly Pt[], cells: ReturnType<typeof voronoiCells>, W = 1000) {
  let area = 0;
  for (const c of cells) {
    expect(c.poly.length).toBeGreaterThanOrEqual(3);
    const a = polygonArea(c.poly);
    expect(a).toBeGreaterThan(0);
    area += a;
    for (let i = 0; i < c.poly.length; i++) {
      const p = c.poly[i]!, q = c.poly[(i + 1) % c.poly.length]!, r = c.poly[(i + 2) % c.poly.length]!;
      expect(p[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(p[0]).toBeLessThanOrEqual(W + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(p[1]).toBeLessThanOrEqual(W + 1e-9);
      // Convexe : tous les virages dans le même sens.
      expect((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])).toBeGreaterThanOrEqual(-1e-6);
    }
  }
  expect(area).toBeCloseTo(W * W, 3);
  const bySite = new Map(cells.map((c) => [c.site, c.poly]));
  const inside = (poly: readonly Pt[], x: number, y: number) =>
    poly.every((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= -1e-6;
    });
  const rnd = mulberry32(7);
  for (let k = 0; k < 400; k++) {
    const x = rnd() * W, y = rnd() * W;
    let best = -1, bd = Infinity;
    sites.forEach(([sx, sy], i) => {
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd && bySite.has(i)) { bd = d; best = i; }
    });
    expect(inside(bySite.get(best)!, x, y)).toBe(true);
  }
}

describe("Voronoï par demi-plans", () => {
  it("pave exactement le cadre avec des polygones convexes", () => {
    const rnd = mulberry32(42);
    const sites: Pt[] = Array.from({ length: 250 }, () => [rnd() * 1000, rnd() * 1000]);
    expectTiling(sites, voronoiCells(sites, 1000, 1000));
  });

  it("cas limites : doublons, sites hors cadre, grille régulière, un seul site", () => {
    const grid: Pt[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) grid.push([100 + i * 200, 100 + j * 200]);
    const withDup: Pt[] = [...grid, [100, 100], [1200, 500], [-50, -50]];
    const cells = voronoiCells(withDup, 1000, 1000);
    expect(cells.find((c) => c.site === 25)).toBeUndefined(); // doublon
    expect(cells.find((c) => c.site === 26)).toBeUndefined(); // trop loin pour toucher le cadre
    expectTiling(withDup, cells);
    expect(voronoiCells([[500, 500]], 1000, 1000)[0]!.poly).toHaveLength(4);
    // Grille régulière : 40 arêtes intérieures (4 × 5 verticales + 4 × 5 horizontales), bords du cadre exclus.
    expect(interiorEdges(voronoiCells(grid, 1000, 1000), 1000, 1000)).toHaveLength(40);
  });
});

describe("Vitrail", () => {
  it("même journée, même plan et même SVG, octet pour octet", () => {
    for (const date of DATES) {
      expect(vitrailPlan(input(date))).toEqual(vitrailPlan(input(date)));
      expect(vitrail.toSvg!(input(date))).toBe(vitrail.toSvg!(input(date)));
    }
  });

  it("deux dates différentes donnent des vitraux différents", () => {
    const svgs = new Set(DATES.map((d) => vitrail.toSvg!(input(d))));
    expect(svgs.size).toBe(DATES.length);
  });

  it("ajouter des jours après J ne change pas l'œuvre de J", () => {
    const cut = days.filter((d) => d.date <= "2026-07-14");
    expect(vitrail.toSvg!(input("2026-07-14", cut))).toBe(vitrail.toSvg!(input("2026-07-14")));
  });

  it("les cellules sont de vrais polygones qui pavent le cadre", () => {
    for (const date of DATES) {
      const { sites, cells } = vitrailPlan(input(date));
      expectTiling(sites.map((s) => [s.x, s.y] as const), cells);
      expect(cells.length).toBeGreaterThan(40);
    }
  });

  it("pas → nombre de verres ; commits → verres vifs", () => {
    const calm = vitrailPlan(input("2026-07-01")); // 3ᵉ centile de pas, 14 commits
    const busy = vitrailPlan(input("2026-07-22")); // 87ᵉ centile, 13 commits
    const hours = (p: typeof calm) => p.sites.filter((s) => s.kind === "heure").length;
    expect(hours(busy)).toBeGreaterThan(hours(calm) + 60);
    expect(calm.sites.filter((s) => s.kind === "commit")).toHaveLength(14);
    const noCommit = vitrailPlan(input("2026-07-22", withDay("2026-07-22", { commits: 0 })));
    expect(noCommit.sites.filter((s) => s.kind === "commit")).toHaveLength(0);
  });

  it("pas horaires mesurés : les verres se groupent autour des heures actives", () => {
    const base = input("2026-07-22");
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 14 ? 9000 : h === 8 ? 3000 : 0));
    const p = vitrailPlan({ ...base, hourlySteps: hourly });
    expect(p.params.hourlyMeasured).toBe(true);
    expect(p.params.peakHour).toBe(14);
    expect(p.params.perHour[14]).toBeGreaterThan(p.params.perHour[8]! * 2);
    expect(p.params.perHour[3]).toBe(1);
    expect(vitrail.explain({ ...base, hourlySteps: hourly }).some((l) => l.source === "Pas heure par heure (mesurés)")).toBe(true);
  });

  it("météo et lune : température → teinte, nuages → bords, lune → lumière", () => {
    const base = input("2026-07-22");
    const weather = { temp_min: 8, temp_max: 12, precip_mm: 0, wind_kmh: 10, wind_dir_deg: 180, cloud: 0.9 };
    const cold = vitrailPlan({ ...base, weather });
    const hot = vitrailPlan({ ...base, weather: { ...weather, temp_max: 33, cloud: 0.1 } });
    expect(cold.params.warmth).toBeLessThan(hot.params.warmth);
    expect(cold.params.vignette).toBeGreaterThan(hot.params.vignette);
    expect(vitrail.toSvg!({ ...base, weather })).not.toBe(vitrail.toSvg!(base));
    const lines = vitrail.explain({ ...base, weather });
    expect(lines.find((l) => l.param.startsWith("Teinte"))!.source).toBe("Température maximale (mesurée)");
    // Lune : pleine (2026-07-29) vs nouvelle (2026-07-14).
    expect(moonPhase("2026-07-29").illumination).toBeGreaterThan(0.95);
    expect(vitrailPlan(input("2026-07-29")).params.glow).toBeGreaterThan(vitrailPlan(input("2026-07-14")).params.glow + 0.4);
  });

  const variants: [string, Partial<DayV2>][] = [
    ["pas", { steps: null }],
    ["sommeil", { sleep_minutes: null, sleep_start: null, sleep_end: null }],
    ["commits", { commits: null }],
    ["tout", { steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null }],
  ];
  for (const [name, patch] of variants) {
    it(`métrique absente (${name}) : plan valide, rendu sans erreur, SVG bien formé avec la marque`, () => {
      const inp = input("2026-07-22", withDay("2026-07-22", patch));
      const { sites, cells } = vitrailPlan(inp);
      expectTiling(sites.map((s) => [s.x, s.y] as const), cells);
      const { ctx, calls } = mockCtx(300);
      vitrail.render(ctx, 300, inp);
      expect(calls.setLineDash).toBeGreaterThan(0); // marque en pointillés
      const svg = vitrail.toSvg!(inp);
      expectWellFormedXml(svg);
      expect(svg).toContain('stroke-dasharray="6 7"');
    });
  }

  it("journée absente de la base : tout à null, œuvre valide", () => {
    const inp = input("2031-01-01");
    expect(inp.day.steps).toBeNull();
    expectWellFormedXml(vitrail.toSvg!(inp));
    expect(vitrail.explain(inp).find((l) => l.param === "Verres désaturés")).toBeDefined();
  });

  it("steps: 0 et steps: null donnent des vitraux différents", () => {
    const zero = input("2026-07-22", withDay("2026-07-22", { steps: 0 }));
    const none = input("2026-07-22", withDay("2026-07-22", { steps: null }));
    expect(vitrail.toSvg!(zero)).not.toBe(vitrail.toSvg!(none));
    // 0 pas : un seul verre par heure ; absent : profil type, verres désaturés.
    expect(vitrailPlan(zero).params.perHour.every((k) => k === 1)).toBe(true);
    expect(vitrailPlan(none).params.perHour.some((k) => k > 1)).toBe(true);
  });

  it("explain : chaque paramètre, sa donnée, sa valeur", () => {
    for (const date of [...DATES, "2026-06-06", "2031-01-01"]) {
      const lines = vitrail.explain(input(date));
      expect(lines.length).toBeGreaterThanOrEqual(8);
      for (const l of lines) expect(l.param && l.source && l.value).toBeTruthy();
      const text = lines.map((l) => `${l.param} ${l.source} ${l.value}`).join("\n");
      expect(text).toMatch(/Pas/);
      expect(text).toMatch(/Commits/);
      expect(text).toMatch(/lune/i);
      expect(text).toMatch(/repli 16 °C/); // pas de météo dans les fixtures
      expect(text).not.toMatch(/NaN|undefined/);
    }
  });

  it("SVG : un polygone et un dégradé de lumière par cellule, plomb en un seul chemin, lisible par resvg", () => {
    const inp = input("2026-07-14");
    const { cells } = vitrailPlan(inp);
    const svg = vitrail.toSvg!(inp);
    expectWellFormedXml(svg);
    expect(svg.match(/<radialGradient /g)).toHaveLength(cells.length + 1); // + assombrissement des bords
    expect(svg.match(/<path d="M[^"]*Z" fill="#[0-9a-f]{6}"\/>/g)).toHaveLength(cells.length);
    expect(svg.match(/stroke="#17140f"/g)).toHaveLength(1);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 200 } }).render();
    expect(png.width).toBe(200);
    const distinct = new Set<number>();
    for (let i = 0; i < png.pixels.length; i += 4 * 37) distinct.add((png.pixels[i]! << 16) | (png.pixels[i + 1]! << 8) | png.pixels[i + 2]!);
    expect(distinct.size).toBeGreaterThan(50);
  });

  it("miniature : même composition, sans grain", () => {
    const inp: TechniqueInput = input("2026-07-14");
    const full = mockCtx(200), preview = mockCtx(200);
    vitrail.render(full.ctx, 200, inp);
    vitrail.render(preview.ctx, 200, inp, { quality: "preview" });
    expect(preview.calls.fill).toBe(full.calls.fill);
    expect(full.calls.putImageData).toBe(1);
    expect(preview.calls.putImageData).toBeUndefined();
  });
});
