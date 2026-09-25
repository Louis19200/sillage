import { describe, expect, it } from "vitest";
import { circlePath, pathToSvg, planToSvg, polygonPath, translatePath } from "./vector";
import { expectWellFormedXml } from "./test-utils";

describe("plan vectoriel → SVG", () => {
  it("arcs : même sens et même étendue que CanvasRenderingContext2D.arc", () => {
    // Cercle complet : deux demi-arcs.
    expect(pathToSvg(circlePath(100, 100, 50))).toBe("M150 100A50 50 0 0 1 50 100A50 50 0 0 1 150 100Z");
    // Demi-disque du haut (de π à 2π, sens horaire à l'écran = par le haut).
    expect(pathToSvg([{ t: "A", cx: 0, cy: 0, r: 10, a0: Math.PI, a1: 2 * Math.PI }, { t: "Z" }])).toBe("M-10 0A10 10 0 0 1 10 0Z");
    // Arc après un point : le canvas trace un segment jusqu'au début de l'arc.
    expect(pathToSvg([{ t: "M", x: 0, y: 0 }, { t: "A", cx: 0, cy: 0, r: 10, a0: 0, a1: Math.PI / 2 }, { t: "Z" }])).toBe("M0 0L10 0A10 10 0 0 1 0 10Z");
    // Grand arc (3/4 de tour) et sens antihoraire.
    expect(pathToSvg([{ t: "A", cx: 0, cy: 0, r: 10, a0: 0, a1: 1.5 * Math.PI }])).toBe("M10 0A10 10 0 1 1 0 -10");
    expect(pathToSvg([{ t: "A", cx: 0, cy: 0, r: 10, a0: 0, a1: -Math.PI / 2, ccw: true }])).toBe("M10 0A10 10 0 0 0 0 -10");
    expect(pathToSvg([{ t: "A", cx: 0, cy: 0, r: 10, a0: 0, a1: -2 * Math.PI, ccw: true }])).toBe("M10 0A10 10 0 0 0 -10 0A10 10 0 0 0 10 0");
  });

  it("déplacement, polygones, document bien formé", () => {
    expect(translatePath(polygonPath([[0, 0], [10, 0], [0, 10]]), 4, 3)).toEqual(polygonPath([[4, 3], [14, 3], [4, 13]]));
    const svg = planToSvg(
      {
        background: "#f4efe6",
        grain: 20,
        grainSeed: 12345,
        shapes: [
          { d: circlePath(500, 500, 100), fill: "#ff0000", fillAlpha: 0.25, blend: "multiply" },
          { d: polygonPath([[0, 0], [10, 0], [0, 10]]), fill: { kind: "radial", cx: 5, cy: 5, r: 9, stops: [[0, "#ffffff", 0.4], [1, "#ffffff", 0]] } },
          { d: [{ t: "M", x: 0, y: 0 }, { t: "L", x: 1000, y: 1000 }], stroke: "#000000", lineWidth: 12, dash: [6, 7], cap: "round" },
        ],
      },
      [],
      { title: "Essai <1> & co", idPrefix: "essai" },
    );
    expectWellFormedXml(svg);
    expect(svg).toContain("<title>Essai &lt;1&gt; &amp; co</title>");
    expect(svg).toContain('fill-opacity="0.25"');
    expect(svg).toContain('style="mix-blend-mode:multiply"');
    expect(svg).toContain('fill="url(#essai-g0)"');
    expect(svg).toContain('stroke-dasharray="6 7"');
    expect(svg).toContain('seed="2345"');
  });
});
