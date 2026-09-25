/**
 * Outils de test des techniques (vitest tourne sans canvas) : un contexte 2D qui enregistre
 * les points tracés, pour vérifier qu'un rendu ne plante pas et reste dans le cadre.
 * Importé seulement par les tests.
 */
import rawDays from "@sillage/shared/fixtures/days.json";
import type { StyleId } from "@sillage/shared";
import { buildTechniqueInput, type DayV2 } from "../input";
import type { Ctx2D, TechniqueInput } from "../types";

export const fixtureDays = rawDays as unknown as DayV2[];

/** Entrée d'une technique pour `date`, avec des champs de la journée remplacés. */
export function inputWith(style: StyleId, date: string, over: Partial<DayV2> = {}, days: DayV2[] = fixtureDays): TechniqueInput {
  const known = days.some((d) => d.date === date);
  const hist = known ? days.map((d) => (d.date === date ? { ...d, ...over } : d)) : [...days, { date, steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null, ...over }];
  return buildTechniqueInput(date, hist, style);
}

/** Combinaisons de `null` exigées (et `steps: 0`, qui ne doit pas ressembler à `null`). */
export const NULL_CASES: { label: string; over: Partial<DayV2> }[] = [
  { label: "pas null", over: { steps: null } },
  { label: "sommeil null", over: { sleep_minutes: null, sleep_start: null, sleep_end: null } },
  { label: "commits null", over: { commits: null } },
  { label: "tout null", over: { steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null } },
  { label: "pas à 0", over: { steps: 0 } },
];

/** Min et max d'une longue liste (sans `Math.min(...liste)`, qui déborde la pile). */
export function extent(values: Iterable<number>): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}

export interface Recording {
  ctx: Ctx2D;
  /** Points passés à moveTo / lineTo / arc (centres), en px. */
  points: [number, number][];
  calls: number;
}

export function recordingCtx(S: number): Recording {
  const points: [number, number][] = [];
  const rec: Recording = { ctx: null as unknown as Ctx2D, points, calls: 0 };
  const target: Record<string, unknown> = {
    moveTo: (x: number, y: number) => points.push([x, y]),
    lineTo: (x: number, y: number) => points.push([x, y]),
    arc: (x: number, y: number) => points.push([x, y]),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  rec.ctx = new Proxy(target, {
    get(t, key: string) {
      rec.calls++;
      if (key in t) return t[key];
      return () => undefined;
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as Ctx2D;
  return rec;
}
