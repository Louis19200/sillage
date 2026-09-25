import { describe, expect, it } from "vitest";
import { techniqueFor } from "../techniques";
import { HARMONO, harmonoParams, harmonographDrawing, harmonographe } from "./harmonographe";
import { extent, fixtureDays, inputWith, NULL_CASES, recordingCtx } from "./testing";

const DATES = ["2026-06-29", "2026-06-19", "2026-07-22"]; // calme, normale, très active

describe("Harmonographe", () => {
  it("est branché dans le registre, porté, vectoriel", () => {
    expect(techniqueFor("harmonographe")).toBe(harmonographe);
    expect(harmonographe.ported).toBe(true);
    expect(harmonographe.toSvg).toBeTypeOf("function");
  });

  it("déterministe : même ligne et même SVG deux fois de suite", () => {
    for (const date of DATES) {
      expect(harmonographDrawing(inputWith("harmonographe", date))).toEqual(harmonographDrawing(inputWith("harmonographe", date)));
      expect(harmonographe.toSvg!(inputWith("harmonographe", date))).toBe(harmonographe.toSvg!(inputWith("harmonographe", date)));
    }
  });

  it("deux journées différentes → deux figures différentes ; jours futurs sans effet", () => {
    const [a, b] = DATES.map((d) => harmonoParams(inputWith("harmonographe", d)));
    expect(a).not.toEqual(b);
    const cut = fixtureDays.filter((d) => d.date <= "2026-06-19");
    expect(harmonographDrawing(inputWith("harmonographe", "2026-06-19", {}, cut))).toEqual(harmonographDrawing(inputWith("harmonographe", "2026-06-19")));
  });

  it("la figure ne sort jamais du cadre : toutes les fixtures, toutes les combinaisons de null, vents extrêmes", () => {
    const lo = HARMONO.margin - 1e-6, hi = 1000 - HARMONO.margin + 1e-6;
    const overs = [{}, ...NULL_CASES.map((c) => c.over), { wind_dir_deg: 0, wind_max_kmh: 120 }, { steps: 60000, commits: 80, sleep_minutes: 60 }];
    for (const [i, day] of fixtureDays.entries()) {
      for (const quality of ["full", "preview"] as const) {
        const dr = harmonographDrawing(inputWith("harmonographe", day.date, overs[i % overs.length]), quality);
        let min = Infinity, max = -Infinity;
        for (const s of dr.strokes) for (const v of s.pts) { if (v < min) min = v; if (v > max) max = v; }
        expect(min, day.date).toBeGreaterThanOrEqual(lo);
        expect(max, day.date).toBeLessThanOrEqual(hi);
        // Et elle remplit le cadre : son plus grand côté touche les marges.
        const { minX, maxX, minY, maxY } = dr.bounds;
        expect(Math.max(maxX - minX, maxY - minY)).toBeCloseTo(1000 - 2 * HARMONO.margin, 6);
      }
    }
  });

  it("le rendu canvas reste dans le cadre à toute taille, et la ligne est continue", () => {
    for (const S of [96, 1000, 3000]) {
      const rec = recordingCtx(S);
      harmonographe.render(rec.ctx, S, inputWith("harmonographe", "2026-07-22"), { quality: S < 200 ? "preview" : "full" });
      const box = extent(rec.points.flat());
      expect(box.min).toBeGreaterThanOrEqual(0);
      expect(box.max).toBeLessThanOrEqual(S);
    }
    const dr = harmonographDrawing(inputWith("harmonographe", "2026-06-19"));
    for (let i = 1; i < dr.strokes.length; i++) {
      const prev = dr.strokes[i - 1]!.pts, cur = dr.strokes[i]!.pts;
      expect([cur[0], cur[1]]).toEqual([prev[prev.length - 2], prev[prev.length - 1]]);
    }
  });

  it("chaque combinaison de null donne une figure valide ; pas à 0 ≠ pas null", () => {
    const params = new Map<string, ReturnType<typeof harmonoParams>>();
    for (const { label, over } of NULL_CASES) {
      const input = inputWith("harmonographe", "2026-06-19", over);
      params.set(label, harmonoParams(input));
      const dr = harmonographDrawing(input);
      expect(dr.strokes.length, label).toBeGreaterThan(10);
      expect(Number.isFinite(dr.scale), label).toBe(true);
      expect(() => harmonographe.render(recordingCtx(200).ctx, 200, input)).not.toThrow();
      // Marque « données manquantes » dans le SVG aussi (pas pour « pas à 0 » : c'est une mesure).
      if (Object.values(over).includes(null)) expect(harmonographe.toSvg!(input), label).toContain("stroke-dasharray");
    }
    expect(params.get("pas à 0")!.stepsRatio).not.toEqual(params.get("pas null")!.stepsRatio);
    expect(harmonographe.toSvg!(inputWith("harmonographe", "2026-06-19"))).not.toContain("stroke-dasharray");
    expect(harmonographDrawing(inputWith("harmonographe", "2031-01-01")).strokes.length).toBeGreaterThan(10);
  });

  it("pilotage : sommeil court → amortissement fort, vent → orientation et rotation de la table", () => {
    const short = harmonoParams(inputWith("harmonographe", "2026-06-19", { sleep_minutes: 200 }));
    const long = harmonoParams(inputWith("harmonographe", "2026-06-19", { sleep_minutes: 600 }));
    expect(short.damp).toBeGreaterThan(long.damp);
    expect(short.detune).toBeGreaterThan(long.detune);
    const w = harmonoParams(inputWith("harmonographe", "2026-06-19", { wind_dir_deg: 90, wind_max_kmh: 60 }));
    expect(w.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(w.spin).toBeCloseTo(1, 10);
    expect(w.windMeasured).toBe(true);
    const fb = harmonoParams(inputWith("harmonographe", "2026-06-19"));
    expect(fb.windMeasured).toBe(false);
    expect(fb.rotation).toBeCloseTo((250 * Math.PI) / 180, 10);
  });

  it("SVG : un chemin par tronçon, mêmes points que le canvas (au dixième près)", () => {
    const input = inputWith("harmonographe", "2026-06-19");
    const dr = harmonographDrawing(input);
    const svg = harmonographe.toSvg!(input);
    const paths = [...svg.matchAll(/<path stroke="(#[0-9a-f]{6})" d="([^"]+)"/g)];
    expect(paths.length).toBe(dr.strokes.length);
    // Relit le dernier chemin (M absolu puis « l » relatifs) et compare au dessin.
    const [, color, d] = paths.at(-1)!;
    const last = dr.strokes.at(-1)!;
    expect(color).toBe(last.color);
    const nums = d!.replace(/^M/, "").replace("l", " ").match(/-?\d+(\.\d+)?/g)!.map(Number);
    let x = nums[0]!, y = nums[1]!;
    for (let i = 2; i < nums.length; i += 2) { x += nums[i]!; y += nums[i + 1]!; }
    expect(x).toBeCloseTo(last.pts[last.pts.length - 2]!, 0);
    expect(y).toBeCloseTo(last.pts[last.pts.length - 1]!, 0);
    expect(nums.length).toBe(last.pts.length);
  });

  it("explain : chaque paramètre, sa donnée, sa valeur", () => {
    const lines = harmonographe.explain(inputWith("harmonographe", "2026-06-19"));
    const params = lines.map((l) => l.param).join(" | ");
    for (const w of ["pendules 1 et 2", "pendules 3 et 4", "Désaccord", "Amortissement", "Orientation", "Rotation lente", "Phases", "échelle", "Couleur"]) expect(params).toContain(w);
    for (const l of lines) expect(l.param && l.source && l.value).toBeTruthy();
    expect(lines.find((l) => l.param.startsWith("Orientation"))!.source).toMatch(/repli 250°/);
    expect(harmonographe.explain(inputWith("harmonographe", "2026-06-19", { steps: null }))[0]!.source).toMatch(/non mesuré → valeur neutre/);
  });
});
