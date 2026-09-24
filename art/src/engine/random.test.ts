import { describe, expect, it } from "vitest";
import { createNoise2D, createRng, cyrb53, mulberry32, seedFromDate } from "./random";
import { catmullRomToBezier } from "./geometry";
import { oklchToHex } from "./color";

describe("hasard seedé", () => {
  it("cyrb53 est stable (valeur de référence)", () => {
    expect(cyrb53("a")).toBe(7929297801672961);
    expect(seedFromDate("2026-09-23")).toBe(seedFromDate("2026-09-23"));
    expect(seedFromDate("2026-09-23")).not.toBe(seedFromDate("2026-09-24"));
  });

  it("mulberry32 rejoue la même suite dans [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("fork donne des flux indépendants et reproductibles", () => {
    const r = createRng(7);
    expect(r.fork("x").next()).toBe(createRng(7).fork("x").next());
    expect(r.fork("x").next()).not.toBe(r.fork("y").next());
  });

  it("le bruit est déterministe et borné", () => {
    const n = createNoise2D(123);
    const m = createNoise2D(123);
    for (let i = 0; i < 200; i++) {
      const v = n(i * 0.37, i * 0.11);
      expect(v).toBe(m(i * 0.37, i * 0.11));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe("utilitaires de rendu", () => {
  it("Catmull-Rom passe par tous les points", () => {
    const path = catmullRomToBezier([[0, 0], [10, 5], [20, 0]], false)!;
    expect(path.start).toEqual([0, 0]);
    expect(path.segments.map((s) => s[2])).toEqual([[10, 5], [20, 0]]);
    expect(catmullRomToBezier([[0, 0], [1, 0], [1, 1]], true)!.segments).toHaveLength(3);
  });

  it("OKLCH → hex reste dans le gamut", () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe("#ffffff");
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe("#000000");
    expect(oklchToHex({ l: 0.7, c: 0.4, h: 30 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});
