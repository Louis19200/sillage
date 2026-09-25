import { describe, expect, it } from "vitest";
import { accumulate, attracteur, attractorParams, COLLAPSE, coverage, intensity, iterations } from "./attracteur";
import { fixtureDays, inputWith, NULL_CASES } from "./testing";

/** Part des pixels visibles (intensité log > 0,35) d'un rendu R × R : ~0,3 % pour une forme effondrée. */
function litFraction(date: string, R: number, total: number, over = {}): { lit: number; restarts: number } {
  const input = inputWith("attracteur", date, over);
  const den = accumulate(input, attractorParams(input), R, total);
  let max = 0;
  for (const v of den.count) if (v > max) max = v;
  let lit = 0;
  for (const v of den.count) if (intensity(v, max) > 0.35) lit++;
  return { lit: lit / (R * R), restarts: den.restarts };
}

describe("Attracteur : jamais de forme effondrée", () => {
  it("détecte le chaos transitoire (le 6 juillet 2026 remplissait bien ses 30 000 premiers points, puis tombait sur un cycle)", () => {
    const p = attractorParams(inputWith("attracteur", "2026-07-06"));
    expect(coverage(p.a0, p.b, p.c, p.d, 30_000)).toBeGreaterThan(COLLAPSE.minFill); // l'ancien test passait
    expect(coverage(p.a0, p.b, p.c, p.d)).toBeLessThan(0.01); // la vraie orbite : un cycle
    expect(p.nudges).toBeGreaterThan(0);
    expect(p.fill).toBeGreaterThanOrEqual(COLLAPSE.minFill);
  });

  it("toutes les journées des fixtures : forme pleine sur toute l'orbite vérifiée, et image non vide", () => {
    for (const d of fixtureDays) {
      const p = attractorParams(inputWith("attracteur", d.date));
      expect(p.fill, d.date).toBeGreaterThanOrEqual(COLLAPSE.minFill);
      // Densité réelle du rendu (160 × 160, 200 000 points) ; au-delà de l'orbite vérifiée, le filet
      // de `accumulate` prend le relais (test suivant).
      const { lit, restarts } = litFraction(d.date, 160, 200_000);
      expect(lit, d.date).toBeGreaterThan(0.04);
      expect(restarts, d.date).toBe(0);
    }
  }, 120_000);

  it("chaque combinaison de null (et pas à 0) : forme pleine, rendu sans plantage", () => {
    for (const { label, over } of NULL_CASES) {
      for (const date of ["2026-07-06", "2026-06-19"]) {
        const input = inputWith("attracteur", date, over);
        expect(attractorParams(input).fill, `${date} ${label}`).toBeGreaterThanOrEqual(COLLAPSE.minFill);
        // (Le rendu lui-même passe par un canvas hors écran, absent de Node : vérifié par capture:v2.)
        expect(litFraction(date, 120, iterations(250, "preview"), over).lit, `${date} ${label}`).toBeGreaterThan(0.04);
        expect(attracteur.explain(input).length).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("filet du rendu : une orbite qui s'effondre au-delà de la vérification est relancée, pas dessinée", () => {
    // Paramètres bruts (sans décalage) du 4 juin 2026 : cycle de 4 points dès ~50 000 itérations.
    const p = attractorParams(inputWith("attracteur", "2026-06-04"));
    const input = inputWith("attracteur", "2026-06-04");
    const den = accumulate(input, { a: p.a0, b: p.b, c: p.c, d: p.d }, 100, 400_000);
    expect(den.restarts).toBeGreaterThan(0);
    let cells = 0;
    for (const v of den.count) if (v > 0) cells++;
    expect(cells).toBeGreaterThan(400); // la forme transitoire, pas 4 points
    // Déterministe : mêmes relances, même densité.
    expect(accumulate(input, { a: p.a0, b: p.b, c: p.c, d: p.d }, 100, 400_000).count).toEqual(den.count);
  });

  it("déterministe, et explain annonce le décalage et le remplissage vérifié", () => {
    const a = attractorParams(inputWith("attracteur", "2026-07-06"));
    expect(attractorParams(inputWith("attracteur", "2026-07-06"))).toEqual(a);
    const lines = attracteur.explain(inputWith("attracteur", "2026-07-06"));
    expect(lines[0]!.value).toMatch(/au lieu de/);
    expect(lines.find((l) => l.param === "Remplissage vérifié")!.value).toMatch(/% de la grille/);
  });
});
