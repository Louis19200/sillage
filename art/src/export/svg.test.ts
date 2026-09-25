import { describe, expect, it } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { DailyMetrics } from "@sillage/shared";
import { Resvg } from "@resvg/resvg-js";
import { composeForDate, type DayInput, type Scene } from "../engine";
import { num, pathData, sceneToSvg } from "./svg";
import { readPngDpi, setPngDpi } from "./png-dpi";

const FIXTURES: DayInput[] = DailyMetrics.array().parse(rawDays);

/** Vérifie la bonne formation XML (balises équilibrées, attributs entre guillemets, entités connues). */
function expectWellFormedXml(xml: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let last = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const text = xml.slice(last, m.index);
    expect(text, `texte invalide avant ${m[0].slice(0, 40)}`).not.toMatch(/[<>]|&(?!(amp|lt|gt|quot|apos);)/);
    last = tag.lastIndex;
    if (!m[2]) continue;
    const [, closing, name, , selfClosing] = m;
    if (closing) expect(stack.pop()).toBe(name);
    else if (!selfClosing) stack.push(name!);
  }
  expect(xml.slice(last).trim()).toBe("");
  expect(stack).toEqual([]);
  // Tout ce qui ressemble à une balise doit avoir été reconnu par l'expression ci-dessus.
  expect(xml.replace(tag, "")).not.toMatch(/[<>]/);
}

const scenes: Record<string, Scene> = {
  // Journée complète (sommeil, pas, commits) : œuvre diurne, pierres.
  "2026-07-14": composeForDate("2026-07-14", FIXTURES),
  // Pas `null` et commits `null` : sillages et pierres fantômes en pointillés.
  "2026-06-06": composeForDate("2026-06-06", FIXTURES),
};

describe("sceneToSvg", () => {
  for (const [date, scene] of Object.entries(scenes)) {
    it(`${date} : SVG valide, déterministe, identique à l'instantané`, async () => {
      const svg = sceneToSvg(scene);
      expectWellFormedXml(svg);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">')).toBe(true);
      // Une primitive dessinable = un élément, dans l'ordre (plus le fond).
      const drawn = (svg.match(/<(rect|circle|path) /g) ?? []).length;
      expect(drawn).toBeGreaterThanOrEqual(scene.primitives.length);
      expect(svg).not.toMatch(/NaN|Infinity|undefined|-0[ ",]/);
      // Déterministe : une Scene recomposée donne la même chaîne, octet pour octet.
      expect(sceneToSvg(composeForDate(date, FIXTURES))).toBe(svg);
      await expect(svg).toMatchFileSnapshot(`./__snapshots__/sillage-${date}.svg`);
    });
  }

  it("un moteur SVG indépendant (resvg) le lit et le dessine", () => {
    const svg = sceneToSvg(scenes["2026-07-14"]!, { size: 200 });
    const png = new Resvg(svg).render();
    expect(png.width).toBe(200);
    const px = png.pixels;
    // L'image n'est pas unie : il y a bien un dessin.
    const distinct = new Set<number>();
    for (let i = 0; i < px.length; i += 4 * 97) distinct.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    expect(distinct.size).toBeGreaterThan(50);
  });

  it("taille libre, métadonnées facultatives, pointillés et opacités", () => {
    const scene = scenes["2026-06-06"]!;
    const svg = sceneToSvg(scene, { size: "30cm", metadata: false });
    expect(svg).toContain('width="30cm" height="30cm" viewBox="0 0 1000 1000"');
    expect(svg).not.toContain("<title>");
    expect(sceneToSvg(scene)).toContain("<title>Sillage · 2026-06-06</title>");
    expect(svg).toContain("stroke-dasharray=");
    expect(svg).toMatch(/(stroke|fill|stop)-opacity="0\.\d+"/);
  });

  it("chemins : droits, lisses, fermés", () => {
    expect(num(-0.001)).toBe("0");
    expect(num(1 / 3)).toBe("0.33");
    expect(pathData([[0, 0], [10, 0], [10, 10]], false, true)).toBe("M0 0l10 0 0 10z");
    expect(pathData([[5, 5], [2.5, -1]], false, false)).toBe("M5 5l-2.5-6");
    expect(pathData([[0, 0]], true, false)).toBeNull();
    expect(pathData([[0, 0], [6, 0]], true, false)).toBe("M0 0c1 0 5 0 6 0");
    expect(pathData([[1, 1], [7, 1], [7, -5]], true, false)).toBe("M1 1c1 0 5 1 6 0 1-1 0-5 0-6");
  });

  it("chemins relatifs sans dérive : les déplacements retombent exactement sur le dernier point", () => {
    const pts: [number, number][] = Array.from({ length: 300 }, (_, i) => [i * 3.337, Math.sin(i) * 41.113]);
    const d = pathData(pts, true, false)!;
    const nums = d.slice(1).replace("c", " ").replace(/-/g, " -").trim().split(/\s+/).map(Number);
    let [x, y] = [Math.round(nums[0]! * 100), Math.round(nums[1]! * 100)];
    for (let i = 2; i < nums.length; i += 6) {
      x += Math.round(nums[i + 4]! * 100);
      y += Math.round(nums[i + 5]! * 100);
    }
    expect(x).toBe(Math.round(pts.at(-1)![0] * 100));
    expect(y).toBe(Math.round(pts.at(-1)![1] * 100));
  });
});

describe("PNG : résolution d'impression", () => {
  it("ajoute puis remplace le bloc pHYs sans toucher à l'image", () => {
    const png = new Uint8Array(new Resvg(sceneToSvg(scenes["2026-06-06"]!, { size: 64 })).render().asPng());
    const at300 = setPngDpi(png, 300);
    expect(readPngDpi(at300)).toBe(300);
    const at150 = setPngDpi(at300, 150);
    expect(readPngDpi(at150)).toBe(150);
    expect(at150.length).toBe(at300.length);
    // Toujours lisible comme image par un décodeur PNG.
    const back = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${Buffer.from(at150).toString("base64")}"/></svg>`).render();
    expect(back.width).toBe(64);
    expect(() => setPngDpi(new Uint8Array([1, 2, 3]), 300)).toThrow();
  });
});
