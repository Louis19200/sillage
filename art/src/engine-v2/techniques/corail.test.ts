import { describe, expect, it } from "vitest";
import { techniqueFor } from "../techniques";
import { CORAIL, coralDrawing, coralParams, corail, growCoral } from "./corail";
import { extent, fixtureDays, inputWith, NULL_CASES, recordingCtx } from "./testing";

const DATES = ["2026-06-29", "2026-06-19", "2026-07-22"]; // calme, normale, très active

describe("Corail", () => {
  it("est branché dans le registre, porté, vectoriel", () => {
    expect(techniqueFor("corail")).toBe(corail);
    expect(corail.ported).toBe(true);
    expect(corail.toSvg).toBeTypeOf("function");
  });

  it("déterministe : même dessin et même SVG deux fois de suite", () => {
    for (const date of DATES) {
      const a = coralDrawing(inputWith("corail", date));
      const b = coralDrawing(inputWith("corail", date));
      expect(a).toEqual(b);
      expect(corail.toSvg!(inputWith("corail", date))).toBe(corail.toSvg!(inputWith("corail", date)));
    }
  });

  it("deux journées différentes → deux coraux différents", () => {
    const [a, b] = DATES.map((d) => coralDrawing(inputWith("corail", d)));
    expect(a!.segments).not.toEqual(b!.segments);
  });

  it("ajouter des jours après J ne change pas le corail de J", () => {
    const cut = fixtureDays.filter((d) => d.date <= "2026-06-19");
    expect(coralDrawing(inputWith("corail", "2026-06-19", {}, cut))).toEqual(coralDrawing(inputWith("corail", "2026-06-19")));
  });

  it("pilotage : pas → nutriments, commits → racines, sommeil → épaisseur, vent → inclinaison", () => {
    const base = coralParams(inputWith("corail", "2026-06-19"));
    expect(coralParams(inputWith("corail", "2026-06-19", { steps: 30000 })).nutrients).toBeGreaterThan(base.nutrients);
    expect(coralParams(inputWith("corail", "2026-06-19", { commits: 0 })).roots).toBeLessThan(base.roots);
    expect(coralParams(inputWith("corail", "2026-06-19", { sleep_minutes: 700 })).thick).toBeGreaterThan(base.thick);
    // Vent d'ouest → pousse vers l'est (droite) ; vent d'est → vers la gauche.
    expect(coralParams(inputWith("corail", "2026-06-19", { wind_dir_deg: 270, wind_max_kmh: 40 })).lean).toBeGreaterThan(0);
    expect(coralParams(inputWith("corail", "2026-06-19", { wind_dir_deg: 90, wind_max_kmh: 40 })).lean).toBeLessThan(0);
    // Pas horaires : plus de nutriments du côté des heures actives.
    const hourly = Array.from({ length: 24 }, (_, h) => (h >= 18 ? 1500 : 0));
    const evening = coralParams(inputWith("corail", "2026-06-19", { hourly_steps: hourly }));
    expect(evening.hourlyMeasured).toBe(true);
    expect(evening.hourWeights.at(-1)).toBeGreaterThan(evening.hourWeights[0]!);
  });

  it("chaque combinaison de null donne un dessin valide ; pas à 0 ≠ pas null", () => {
    const drawings = new Map<string, ReturnType<typeof coralDrawing>>();
    for (const { label, over } of NULL_CASES) {
      const input = inputWith("corail", "2026-06-19", over);
      const dr = coralDrawing(input);
      drawings.set(label, dr);
      expect(dr.segments.length, label).toBeGreaterThan(100);
      for (const s of dr.segments) expect(Number.isFinite(s.x1 + s.y1 + s.x2 + s.y2 + s.w), label).toBe(true);
      const rec = recordingCtx(300);
      expect(() => corail.render(rec.ctx, 300, input)).not.toThrow();
      expect(corail.explain(input).length).toBeGreaterThanOrEqual(6);
    }
    expect(drawings.get("pas null")!.buds.every((b) => b.hollow)).toBe(true);
    expect(drawings.get("pas à 0")!.buds.some((b) => b.hollow)).toBe(false);
    expect(drawings.get("pas à 0")!.segments).not.toEqual(drawings.get("pas null")!.segments);
    expect(drawings.get("commits null")!.ghostRoots.length).toBeGreaterThan(0);
    expect(drawings.get("pas null")!.ghostRoots).toEqual([]);
    // Journée absente de la base : tout à null, pas de plantage.
    expect(coralDrawing(inputWith("corail", "2031-01-01")).segments.length).toBeGreaterThan(100);
  });

  it("aucun tronc isolé : chaque arbre ramifie, et rien ne sort du cadre (toutes les fixtures, avec et sans vent fort)", () => {
    const winds = [{}, { wind_dir_deg: 90, wind_max_kmh: 60 }, { wind_dir_deg: 270, wind_max_kmh: 60 }];
    for (const [i, day] of fixtureDays.entries()) {
      const input = inputWith("corail", day.date, winds[i % winds.length]);
      const t = growCoral(input);
      for (let r = 0; r < t.rootX.length; r++) {
        let tips = 0;
        for (let j = 0; j < t.x.length; j++) if (t.tree[j] === r && t.children[j] === 0) tips++;
        expect(tips, `${day.date} arbre ${r}`).toBeGreaterThanOrEqual(12);
        // Tronc nu (de la racine à la première fourche) : jamais plus d'un tiers de la hauteur.
        let node = r, bare = 0;
        for (;;) {
          const kids = t.parent.flatMap((p, j) => (p === node ? [j] : []));
          if (kids.length !== 1) break;
          bare += Math.hypot(t.x[kids[0]!]! - t.x[node]!, t.y[kids[0]!]! - t.y[node]!);
          node = kids[0]!;
        }
        expect(bare, `${day.date} arbre ${r}`).toBeLessThan(330);
      }
      expect(extent(t.x).min, day.date).toBeGreaterThan(20);
      expect(extent(t.x).max, day.date).toBeLessThan(980);
      expect(extent(t.y).min, day.date).toBeGreaterThan(CORAIL.crown.yMin - CORAIL.step - 1);
      expect(extent(t.y).max, day.date).toBeLessThanOrEqual(CORAIL.groundY);
    }
  }, 120_000);

  it("le rendu reste dans le cadre à toute taille", () => {
    for (const S of [120, 1000]) {
      const rec = recordingCtx(S);
      corail.render(rec.ctx, S, inputWith("corail", "2026-07-22"));
      expect(rec.points.length).toBeGreaterThan(1000);
      const box = extent(rec.points.flat());
      expect(box.min).toBeGreaterThanOrEqual(0);
      expect(box.max).toBeLessThanOrEqual(S);
    }
  });

  it("explain : chaque paramètre, sa donnée, sa valeur ; repli météo annoncé", () => {
    const lines = corail.explain(inputWith("corail", "2026-06-19"));
    const params = lines.map((l) => l.param).join(" | ");
    for (const w of ["Nutriments", "Répartition", "racines", "Épaisseur", "Inclinaison", "Bourgeons", "Couleurs"]) expect(params).toContain(w);
    for (const l of lines) expect(l.param && l.source && l.value).toBeTruthy();
    expect(lines.find((l) => l.param.startsWith("Inclinaison"))!.source).toMatch(/repli/);
    const measured = corail.explain(inputWith("corail", "2026-06-19", { wind_dir_deg: 270, wind_max_kmh: 30 }));
    expect(measured.find((l) => l.param.startsWith("Inclinaison"))!.source).toMatch(/Vent mesuré \(270°, 30 km\/h\)/);
  });
});
