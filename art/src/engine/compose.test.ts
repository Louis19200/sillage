import { afterEach, describe, expect, it, vi } from "vitest";
import rawDays from "@sillage/shared/fixtures/days.json";
import { DailyMetrics } from "@sillage/shared";
import { composeDay, composeForDate, emptyDay, normalizeDay, seedFromDate, type DayInput, type Scene } from "./index";
import { addDays } from "./dates";

const FIXTURES: DayInput[] = DailyMetrics.array().parse(rawDays);
const fixture = (date: string): DayInput => {
  const d = FIXTURES.find((x) => x.date === date);
  if (!d) throw new Error(`pas de fixture pour ${date}`);
  return d;
};
const compose = (day: DayInput, history: readonly DayInput[] = FIXTURES): Scene =>
  composeDay(day, normalizeDay(day, history), seedFromDate(day.date));

/** Vérifie qu'une Scene est dessinable et sérialisable sans perte (JSON pur : ni -0, ni NaN, ni Infinity). */
function expectValidScene(scene: Scene): void {
  expect(scene.size).toBe(1000);
  expect(scene.background).toMatch(/^#[0-9a-f]{6}$/);
  expect(scene.primitives.length).toBeGreaterThan(0);
  const problems: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0)) problems.push(`${path} = ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      if ("color" in v && "alpha" in v) {
        const { color, alpha } = v as { color: unknown; alpha: unknown };
        if (typeof color !== "string" || !/^#[0-9a-f]{6}$/.test(color)) problems.push(`${path}.color = ${String(color)}`);
        if (typeof alpha !== "number" || alpha < 0 || alpha > 1) problems.push(`${path}.alpha = ${String(alpha)}`);
      }
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    } else if (v === undefined) {
      problems.push(`${path} indéfini`);
    }
  };
  walk(scene, "scene");
  for (const prim of scene.primitives) {
    if ((prim.kind === "curve" || prim.kind === "polygon") && prim.points.length < 2) {
      problems.push(`${prim.layer} : moins de 2 points`);
    }
  }
  expect(problems).toEqual([]);
  const json = JSON.stringify(scene);
  expect(JSON.stringify(JSON.parse(json))).toBe(json);
}

const layers = (scene: Scene) => new Set(scene.primitives.map((p) => p.layer));

afterEach(() => vi.restoreAllMocks());

describe("composeDay : même journée, même œuvre", () => {
  it("rend exactement la même Scene deux fois de suite", () => {
    for (const date of ["2026-05-27", "2026-06-20", "2026-07-14", "2026-09-23"]) {
      const a = compose(fixture(date));
      const b = compose(fixture(date));
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it("n'utilise ni Math.random ni l'horloge", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random interdit");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now interdit");
    });
    expect(() => compose(fixture("2026-08-14"))).not.toThrow();
  });

  it("deux dates différentes des fixtures donnent des scènes différentes", () => {
    const scenes = FIXTURES.map((d) => JSON.stringify(compose(d).primitives));
    expect(new Set(scenes).size).toBe(FIXTURES.length);
  });

  it("toutes les journées des fixtures donnent une scène valide", () => {
    for (const d of FIXTURES) expectValidScene(compose(d));
  });
});

describe("pas d'effet rétroactif", () => {
  it("ajouter des jours après J ne change pas la scène de J", () => {
    for (const J of ["2026-06-02", "2026-07-20", "2026-09-01"]) {
      const past = FIXTURES.filter((d) => d.date <= J);
      const withFuture = [
        ...FIXTURES,
        ...Array.from({ length: 60 }, (_, i): DayInput => ({
          ...emptyDay(addDays("2026-09-24", i)),
          steps: 40_000,
          sleep_minutes: 700,
          commits: 60,
        })),
      ];
      expect(composeForDate(J, withFuture)).toEqual(composeForDate(J, past));
    }
  });

  it("modifier un jour postérieur ne change pas la scène de J", () => {
    const J = "2026-08-10";
    const edited = FIXTURES.map((d) => (d.date > J ? { ...d, steps: 0, commits: 0 } : d));
    expect(composeForDate(J, edited)).toEqual(composeForDate(J, FIXTURES));
  });
});

describe("données manquantes", () => {
  const base = fixture("2026-07-14"); // toutes les métriques présentes
  const combos: [boolean, boolean, boolean][] = [];
  for (let m = 0; m < 8; m++) combos.push([!!(m & 1), !!(m & 2), !!(m & 4)]);

  it.each(combos)("pas null=%s, sommeil null=%s, commits null=%s → scène valide", (s, sl, c) => {
    const day: DayInput = {
      ...base,
      steps: s ? null : base.steps,
      sleep_minutes: sl ? null : base.sleep_minutes,
      sleep_start: sl ? null : base.sleep_start,
      sleep_end: sl ? null : base.sleep_end,
      commits: c ? null : base.commits,
    };
    const scene = compose(day);
    expectValidScene(scene);
    const l = layers(scene);
    expect(l.has("wake-unknown")).toBe(s);
    expect(l.has("orb-unknown")).toBe(sl);
    expect(l.has("stone-unknown")).toBe(c);
    expect(scene.meta.missing).toEqual([...(s ? ["steps"] : []), ...(sl ? ["sleep"] : []), ...(c ? ["commits"] : [])]);
  });

  it("une journée absente de la base est rendue comme tout à null", () => {
    const date = "2026-10-05";
    const scene = composeForDate(date, FIXTURES);
    expectValidScene(scene);
    expect(scene).toEqual(compose(emptyDay(date)));
    expect(scene.meta.missing).toEqual(["steps", "sleep", "commits"]);
  });

  it("steps: 0 et steps: null donnent des scènes différentes", () => {
    const day = fixture("2026-06-20"); // vraie journée à 0 pas dans les fixtures
    expect(day.steps).toBe(0);
    const zero = compose(day);
    const missing = compose({ ...day, steps: null });
    expect(zero).not.toEqual(missing);
    expect(layers(zero).has("wake-still")).toBe(true);
    expect(layers(zero).has("wake-unknown")).toBe(false);
    expect(layers(missing).has("wake-unknown")).toBe(true);
    expect(layers(missing).has("wake-still")).toBe(false);
  });

  it("commits: 0 (aucune pierre) diffère de commits: null (pierres fantômes)", () => {
    const day = fixture("2026-06-20");
    const zero = compose({ ...day, commits: 0 });
    const missing = compose({ ...day, commits: null });
    expect(layers(zero).has("stone")).toBe(false);
    expect(layers(zero).has("stone-unknown")).toBe(false);
    expect(layers(missing).has("stone-unknown")).toBe(true);
  });

  it("une pierre par commit", () => {
    const day = fixture("2026-07-14");
    const stones = compose(day).primitives.filter((p) => p.layer === "stone");
    expect(stones.length).toBe(day.commits);
  });
});
