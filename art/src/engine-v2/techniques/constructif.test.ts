import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { Resvg } from "@resvg/resvg-js";
import { buildTechniqueInput, type DayV2 } from "../input";
import { constructif, constructifPlan } from "./constructif";
import { expectWellFormedXml, mockCtx } from "./test-utils";

const days = rawDays as unknown as DayV2[];
const DATES = ["2026-06-29", "2026-07-01", "2026-07-14", "2026-07-22", "2026-08-26"];
const input = (date: string, history: readonly DayV2[] = days) => buildTechniqueInput(date, history, "constructif");
const withDay = (date: string, patch: Partial<DayV2>) => days.map((d) => (d.date === date ? { ...d, ...patch } : d));
const INNER = 840;

describe("Constructif", () => {
  it("même journée, même plan et même SVG, octet pour octet", () => {
    for (const date of DATES) {
      const a = constructifPlan(input(date)), b = constructifPlan(input(date));
      expect(a.plan).toEqual(b.plan);
      expect(a.modules).toEqual(b.modules);
      expect(constructif.toSvg!(input(date))).toBe(constructif.toSvg!(input(date)));
    }
  });

  it("deux dates différentes donnent des compositions différentes", () => {
    expect(new Set(DATES.map((d) => constructif.toSvg!(input(d)))).size).toBe(DATES.length);
  });

  it("ajouter des jours après J ne change pas l'œuvre de J", () => {
    const cut = days.filter((d) => d.date <= "2026-07-14");
    expect(constructif.toSvg!(input("2026-07-14", cut))).toBe(constructif.toSvg!(input("2026-07-14")));
  });

  it("la composition varie vraiment d'un jour à l'autre (grilles, dispositions, vocabulaires)", () => {
    const all = days.map((d) => constructifPlan(input(d.date)).params);
    expect(new Set(all.map((p) => p.G))).toEqual(new Set([4, 5, 6]));
    expect(new Set(all.map((p) => p.layout)).size).toBe(5);
    expect(new Set(all.map((p) => [...p.vocab].sort().join(","))).size).toBeGreaterThan(30);
    expect(all.some((p) => p.bigModule)).toBe(true);
    expect(all.some((p) => !p.bigModule)).toBe(true);
    // Aucune combinaison (grille, disposition, vocabulaire) ne revient plus de 3 fois sur 120 jours.
    const combos = new Map<string, number>();
    for (const p of all) {
      const k = `${p.G}|${p.layout}|${[...p.vocab].sort().join(",")}`;
      combos.set(k, (combos.get(k) ?? 0) + 1);
    }
    expect(Math.max(...combos.values())).toBeLessThanOrEqual(3);
  });

  it("le disque maître reste sous les modules et n'écrase pas la composition", () => {
    for (const d of days) {
      const { plan, disk } = constructifPlan(input(d.date));
      expect((Math.PI * disk.r * disk.r) / (INNER * INNER)).toBeLessThanOrEqual(0.13);
      // Plan = couche décalée (n formes) + couche principale (n formes) + filets ; le disque ouvre la couche principale.
      const n = (plan.shapes.length - 1) / 2;
      expect(Number.isInteger(n)).toBe(true);
      const first = plan.shapes[n]!;
      expect(first.d[0]).toMatchObject({ t: "A", cx: disk.cx, cy: disk.cy, r: disk.r });
    }
  });

  it("pas → modules ; commits → petits carrés (plafond 80) ; sommeil → rayon du disque", () => {
    const calm = constructifPlan(input("2026-07-01"));
    const busy = constructifPlan(input("2026-07-22"));
    expect(busy.params.energy).toBeGreaterThan(calm.params.energy);
    const share = (p: typeof calm) => p.modules.filter((m) => m.span === 1).length / (p.params.G * p.params.G);
    expect(share(busy)).toBeGreaterThan(share(calm));
    expect(calm.squares).toHaveLength(14);
    expect(constructifPlan(input("2026-07-22", withDay("2026-07-22", { commits: 500 }))).squares).toHaveLength(80);
    const short = constructifPlan(input("2026-07-03")); // sommeil au 12ᵉ centile
    const long = constructifPlan(input("2026-07-14")); // 100ᵉ centile
    expect(long.disk.r).toBeGreaterThan(short.disk.r + 60);
  });

  it("météo : vent → axe et épaisseur de la diagonale, nuages → recouvrements, température → teinte", () => {
    const base = input("2026-07-22");
    const weather = { temp_min: 2, temp_max: 5, precip_mm: 0, wind_kmh: 50, wind_dir_deg: 0, cloud: 1 };
    const north = constructifPlan({ ...base, weather });
    // Vent du nord : axe vertical.
    expect(Math.abs(north.diagonal.x1 - north.diagonal.x2)).toBeLessThan(1e-6);
    expect(north.params.lineWidth).toBeGreaterThan(constructifPlan(base).params.lineWidth);
    const east = constructifPlan({ ...base, weather: { ...weather, wind_dir_deg: 90 } });
    expect(Math.abs(east.diagonal.y1 - east.diagonal.y2)).toBeLessThan(1e-6);
    // Nuages : sur toute l'année, ciel couvert → plus de modules qui se recouvrent.
    let overcast = 0, clear = 0;
    for (const d of days) {
      const i = input(d.date);
      overcast += constructifPlan({ ...i, weather: { ...weather, cloud: 1 } }).modules.filter((m) => m.scale > 1).length;
      clear += constructifPlan({ ...i, weather: { ...weather, cloud: 0 } }).modules.filter((m) => m.scale > 1).length;
    }
    expect(overcast).toBeGreaterThan(clear * 3);
    expect(constructifPlan({ ...base, weather: { ...weather, temp_max: 30 } }).params.warmth).toBeGreaterThan(north.params.warmth);
    const lines = constructif.explain({ ...base, weather });
    expect(lines.find((l) => l.param === "Grande diagonale (axe)")!.source).toBe("Direction du vent (mesurée)");
    expect(lines.find((l) => l.param.startsWith("Recouvrements"))!.source).toBe("Couverture nuageuse (mesurée)");
  });

  it("sans météo : replis, et la diagonale ne passe pas au même endroit tous les jours", () => {
    const offsets = new Set(DATES.map((d) => Math.round(constructifPlan(input(d)).params.lineOffset)));
    expect(offsets.size).toBe(DATES.length);
    const text = constructif.explain(input("2026-07-14")).map((l) => l.source).join("\n");
    expect(text).toMatch(/repli 250°/);
    expect(text).toMatch(/repli 12 km\/h/);
    expect(text).toMatch(/repli 50 %/);
    expect(text).toMatch(/repli 16 °C/);
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
      const { ctx, calls } = mockCtx(300);
      constructif.render(ctx, 300, inp);
      expect(calls.setLineDash).toBeGreaterThan(0);
      const svg = constructif.toSvg!(inp);
      expectWellFormedXml(svg);
      expect(svg).toContain('stroke-dasharray="6 7"');
    });
  }

  it("sommeil absent : disque maître en pointillés, jamais plein", () => {
    const { disk, plan } = constructifPlan(input("2026-06-08")); // sommeil null dans les fixtures
    expect(disk.measured).toBe(false);
    const n = (plan.shapes.length - 1) / 2;
    expect(plan.shapes[n]!.fill).toBeUndefined();
    expect(plan.shapes[n]!.dash).toEqual([10, 9]);
  });

  it("steps: 0 et steps: null donnent des compositions différentes", () => {
    const zero = input("2026-07-22", withDay("2026-07-22", { steps: 0 }));
    const none = input("2026-07-22", withDay("2026-07-22", { steps: null }));
    expect(constructif.toSvg!(zero)).not.toBe(constructif.toSvg!(none));
    expect(constructifPlan(zero).params.filled).toBeLessThan(constructifPlan(none).params.filled);
  });

  it("explain : chaque paramètre, sa donnée, sa valeur", () => {
    for (const date of [...DATES, "2026-06-06", "2031-01-01"]) {
      const lines = constructif.explain(input(date));
      expect(lines.length).toBeGreaterThanOrEqual(12);
      for (const l of lines) expect(l.param && l.source && l.value).toBeTruthy();
      const text = lines.map((l) => `${l.param} ${l.source} ${l.value}`).join("\n");
      for (const w of ["Grille", "Pas", "Sommeil", "Commits", "vent", "Nuages", "Température"]) expect(text).toMatch(new RegExp(w, "i"));
      expect(text).not.toMatch(/NaN|undefined/);
    }
  });

  it("SVG : formes en chemins (arcs compris), lisible par resvg", () => {
    for (const date of DATES) {
      const svg = constructif.toSvg!(input(date));
      expectWellFormedXml(svg);
      expect(svg).toMatch(/A[\d.]+ [\d.]+ 0 [01] [01] [\d.]+ [\d.]+/); // arcs SVG (disque maître au moins)
      const png = new Resvg(svg, { fitTo: { mode: "width", value: 160 } }).render();
      expect(png.width).toBe(160);
    }
  });

  it("miniature : même composition, sans grain", () => {
    const inp = input("2026-07-14");
    const full = mockCtx(200), preview = mockCtx(200);
    constructif.render(full.ctx, 200, inp);
    constructif.render(preview.ctx, 200, inp, { quality: "preview" });
    expect(preview.calls.fill).toBe(full.calls.fill);
    expect(preview.calls.putImageData).toBeUndefined();
  });
});
