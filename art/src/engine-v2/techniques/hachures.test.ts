import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { buildTechniqueInput, type DayV2 } from "../input";
import type { TechniqueInput } from "../types";
import { HACHURES, UNIT, clipLineCircle, clipLineRect, hachures, hachuresInks, hachuresPlan, hachuresSvg } from "./hachures";
import { techniqueFor } from "./index";

const days = rawDays as unknown as DayV2[];
const DATE = "2026-07-15";
const input = (date = DATE, history: readonly DayV2[] = days) => buildTechniqueInput(date, history, "hachures");
const withDay = (over: Partial<DayV2>, date = DATE) => input(date, days.map((d) => (d.date === date ? { ...d, ...over } : d)));

/** Vérifie qu'un SVG est bien formé : balises équilibrées, attributs entre guillemets, pas de NaN. */
function assertWellFormedSvg(svg: string): void {
  expect(svg.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<svg `)).toBe(true);
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  expect(svg).not.toMatch(/clipPath|<image|<mask|fill="(?!none)/);
  const stack: string[] = [];
  const body = svg.replace(/^<\?xml[^>]*\?>/, "");
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (close) expect(stack.pop()).toBe(name);
    else if (!self) stack.push(name!);
  }
  expect(stack).toEqual([]);
  // Aucune balise mal formée restante.
  expect(body.replace(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g, "")).not.toMatch(/[<>]/);
  for (const d of svg.matchAll(/ d="([^"]*)"/g)) expect(d[1]).toMatch(/^(M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+)+)+$/);
}

function allPoints(plan: ReturnType<typeof hachuresPlan>): number[] {
  return plan.layers.flatMap((l) => l.zones.flat(2));
}

describe("Hachures : déterminisme", () => {
  it("même journée → même plan et même SVG, octet pour octet", () => {
    expect(hachuresPlan(input())).toEqual(hachuresPlan(input()));
    expect(hachuresSvg(input())).toBe(hachuresSvg(input()));
    expect(hachuresSvg(buildTechniqueInput(DATE, days.slice().reverse(), "hachures"))).toBe(hachuresSvg(input()));
  });

  it("deux dates différentes → deux tracés différents", () => {
    expect(hachuresSvg(input("2026-07-15"))).not.toBe(hachuresSvg(input("2026-08-10")));
  });

  it("ajouter des jours après J ne change pas le tracé de J", () => {
    const cut = days.filter((d) => d.date <= DATE);
    expect(hachuresSvg(input(DATE, cut))).toBe(hachuresSvg(input()));
  });

  it("la miniature garde la composition (mêmes rectangles, même disque), traits droits", () => {
    const full = hachuresPlan(input());
    const prev = hachuresPlan(input(), { quality: "preview" });
    expect(prev.rects).toEqual(full.rects);
    expect(prev.disc).toEqual(full.disc);
    expect(prev.cells).toEqual(full.cells);
    for (const z of prev.layers[0]!.zones) for (const p of z) expect(p).toHaveLength(4);
  });
});

describe("Hachures : données", () => {
  it("pas → profondeur, sommeil → disque, commits → accent", () => {
    const low = withDay({ steps: 500, sleep_minutes: 200, commits: 0 });
    const high = withDay({ steps: 30000, sleep_minutes: 700, commits: 40 });
    const pl = hachuresPlan(low), ph = hachuresPlan(high);
    expect(ph.depth).toBeGreaterThan(pl.depth);
    expect(ph.disc.r).toBeGreaterThan(pl.disc.r);
    expect(pl.accentCount).toBe(0);
    expect(ph.accentCount).toBeGreaterThan(0);
    expect(ph.cells.filter((c) => c.accent)).toHaveLength(ph.accentCount);
  });

  it("météo : direction du vent → angle, vitesse → tremblement ; sinon repli", () => {
    const base = input();
    const windy: TechniqueInput = { ...base, weather: { temp_min: 10, temp_max: 18, precip_mm: 0, wind_kmh: 40, wind_dir_deg: 90, cloud: 0.2 } };
    const pb = hachuresPlan(base), pw = hachuresPlan(windy);
    expect(pb.angle).toBeCloseTo((250 * Math.PI) / 180);
    expect(pw.angle).toBeCloseTo(Math.PI / 2);
    expect(pw.tremble).toBeGreaterThan(pb.tremble);
    expect(hachures.explain(base).find((l) => l.param === "Angle des hachures")!.source).toMatch(/repli/);
    expect(hachures.explain(windy).find((l) => l.param === "Angle des hachures")!.source).toBe("Direction du vent");
  });

  it("pas horaires : l'heure la plus active a les hachures les plus serrées", () => {
    const base = input();
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 3 ? 5000 : 10));
    const plan = hachuresPlan({ ...base, hourlySteps: hourly });
    expect(plan.hourlyMeasured).toBe(true);
    for (const c of plan.cells) expect(c.gap).toBeCloseTo(c.hour === 3 ? HACHURES.gapMin : HACHURES.gapMin + HACHURES.gapSpan * (1 - 10 / 5000));
  });

  it("chaque combinaison de null donne un tracé valide et marqué ; journée absente comprise", () => {
    const cases: [string, TechniqueInput][] = [
      ["pas", withDay({ steps: null })],
      ["sommeil", withDay({ sleep_minutes: null, sleep_start: null, sleep_end: null })],
      ["commits", withDay({ commits: null })],
      ["tout", withDay({ steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null })],
      ["absente", input("2031-01-01")],
    ];
    for (const [label, inp] of cases) {
      const plan = hachuresPlan(inp);
      expect(allPoints(plan).every(Number.isFinite), label).toBe(true);
      expect(plan.rects.length, label).toBeGreaterThan(0);
      expect(plan.layers.some((l) => l.id === "manque"), label).toBe(true);
      assertWellFormedSvg(hachuresSvg(inp));
      for (const l of hachures.explain(inp)) expect(l.param && l.source && l.value, label).toBeTruthy();
    }
    expect(hachuresPlan(cases[1]![1]).disc.dashed).toBe(true);
    expect(hachuresPlan(input()).disc.dashed).toBe(false);
    expect(hachuresPlan(input()).layers.some((l) => l.id === "manque")).toBe(false);
  });

  it("steps: 0 et steps: null donnent des tracés différents", () => {
    expect(hachuresSvg(withDay({ steps: 0 }))).not.toBe(hachuresSvg(withDay({ steps: null })));
  });

  it("encre sur papier, même en humeur nocturne", () => {
    const night = hachuresInks({ id: "x", name: "x", season: "ete", mood: "nocturne", paper: "#101010", ink: "#f2ece1", night: "#000000", colors: ["#1f5f6b", "#e07a4f", "#f2b84b", "#8fb39a", "#b8413c"] });
    expect(night).toMatchObject({ paper: "#f2ece1", ink: "#101010", swapped: true });
    const day = hachuresInks(input().palette);
    expect(day.swapped).toBe(false);
    expect(input().palette.colors).toContain(day.accent);
  });
});

describe("Hachures : géométrie et SVG", () => {
  it("découpe d'une droite dans un rectangle et un disque", () => {
    expect(clipLineRect(0, 5, 1, 0, { x: 2, y: 0, w: 6, h: 10 })).toEqual([2, 8]);
    expect(clipLineRect(0, 50, 1, 0, { x: 2, y: 0, w: 6, h: 10 })).toBeNull();
    const c = clipLineCircle(0, 0, 1, 0, 10, 0, 3)!;
    expect(c[0]).toBeCloseTo(7);
    expect(c[1]).toBeCloseTo(13);
    expect(clipLineCircle(0, 5, 1, 0, 10, 0, 3)).toBeNull();
  });

  it("chaque hachure reste dans son rectangle, hors de la réserve du disque ; celles du disque dedans", () => {
    for (const date of ["2026-07-15", "2026-08-10", "2026-06-11", "2026-09-02"]) {
      const plan = hachuresPlan(input(date));
      const tol = plan.tremble / 2 + 1e-6;
      const { cx, cy, r } = plan.disc;
      for (const layer of plan.layers.filter((l) => l.zoneRects)) {
        layer.zones.forEach((zone, zi) => {
          const rect = plan.rects[layer.zoneRects![zi]!]!;
          const box = { x0: rect.x + HACHURES.inset, y0: rect.y + HACHURES.inset, x1: rect.x + rect.w - HACHURES.inset, y1: rect.y + rect.h - HACHURES.inset };
          for (const p of zone) {
            for (let i = 0; i < p.length; i += 2) {
              const x = p[i]!, y = p[i + 1]!;
              const exact = i === 0 || i === p.length - 2;
              const t = exact ? 1e-6 : tol;
              expect(x >= box.x0 - t && x <= box.x1 + t && y >= box.y0 - t && y <= box.y1 + t, `${date} ${x},${y} hors de ${JSON.stringify(box)}`).toBe(true);
              expect(Math.hypot(x - cx, y - cy)).toBeGreaterThanOrEqual(r + HACHURES.discReserve - t);
            }
            // Une hachure ne traverse pas la réserve : son milieu non plus.
            const mx = (p[0]! + p[p.length - 2]!) / 2, my = (p[1]! + p[p.length - 1]!) / 2;
            expect(Math.hypot(mx - cx, my - cy)).toBeGreaterThanOrEqual(r + HACHURES.discReserve - tol);
          }
        });
      }
      for (const id of ["disque-1", "disque-2"]) {
        const layer = plan.layers.find((l) => l.id === id)!;
        expect(layer.zones[0]!.length).toBeGreaterThan(10);
        for (const p of layer.zones[0]!) for (let i = 0; i < p.length; i += 2) {
          const exact = i === 0 || i === p.length - 2;
          expect(Math.hypot(p[i]! - cx, p[i + 1]! - cy)).toBeLessThanOrEqual(r + (exact ? 1e-6 : tol));
        }
      }
      // Tout reste sur la feuille.
      expect(allPoints(plan).every((v) => v >= 0 && v <= UNIT)).toBe(true);
    }
  });

  it("SVG prêt à tracer : bien formé, chemins seuls, un calque par encre, sans remplissage", () => {
    const svg = hachuresSvg(input());
    assertWellFormedSvg(svg);
    expect(svg).toContain('viewBox="0 0 1000 1000"');
    expect(svg).toContain('width="300mm"');
    const groups = [...svg.matchAll(/<g id="([^"]+)" inkscape:groupmode="layer"/g)].map((m) => m[1]);
    expect(groups).toEqual(expect.arrayContaining(["encre", "disque-1", "disque-2", "contour"]));
    expect(svg.match(/<(?!\/|\?)([a-z]+)/g)!.every((t) => ["<svg", "<title", "<desc", "<g", "<path"].includes(t))).toBe(true);
    // Le SVG contient exactement les polylignes du plan.
    const plan = hachuresPlan(input());
    const polylines = plan.layers.reduce((n, l) => n + l.zones.reduce((m, z) => m + z.length, 0), 0);
    expect((svg.match(/M/g) ?? []).length).toBe(polylines);
  });

  it("registre : Hachures portée, avec export SVG", () => {
    const t = techniqueFor("hachures");
    expect(t).toBe(hachures);
    expect(t.ported).toBe(true);
    expect(t.toSvg).toBeDefined();
  });
});
