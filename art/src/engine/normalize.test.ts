import { describe, expect, it } from "vitest";
import { emptyDay, type DayInput } from "./day";
import { addDays } from "./dates";
import {
  DEFAULTS,
  MIN_REFERENCE_POINTS,
  defaultNorm,
  normalizeDay,
  percentileRank,
  referenceValues,
} from "./normalize";

const day = (date: string, steps: number | null, sleep: number | null = 420, commits: number | null = 3): DayInput => ({
  ...emptyDay(date),
  steps,
  sleep_minutes: sleep,
  commits,
});

/** n jours consécutifs finissant la veille de `date`, pas = 1000, 2000, … */
function before(date: string, n: number): DayInput[] {
  return Array.from({ length: n }, (_, i) => day(addDays(date, -(n - i)), (i + 1) * 1000));
}

describe("percentileRank", () => {
  it("donne 0 sous le minimum, 1 au-dessus du maximum, ½ pour les égalités", () => {
    expect(percentileRank(0, [1, 2, 3])).toBe(0);
    expect(percentileRank(10, [1, 2, 3])).toBe(1);
    expect(percentileRank(2, [1, 2, 3])).toBeCloseTo(0.5);
    expect(percentileRank(5, [5, 5, 5, 5])).toBe(0.5);
  });

  it("est robuste aux valeurs extrêmes", () => {
    const ref = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(6, ref)).toBe(percentileRank(6, [...ref.slice(0, 9), 1_000_000]));
  });
});

describe("defaultNorm", () => {
  it("vaut ½ à l'habitude par défaut et 0 à zéro", () => {
    expect(defaultNorm("steps", DEFAULTS.steps.median)).toBeCloseTo(0.5);
    expect(defaultNorm("sleep_minutes", 450)).toBeCloseTo(0.5);
    expect(defaultNorm("commits", 4)).toBeCloseTo(0.5);
    expect(defaultNorm("steps", 0)).toBe(0);
    expect(defaultNorm("steps", 16000)).toBeGreaterThan(0.75);
  });
});

describe("referenceValues", () => {
  it("ne prend que les 90 jours strictement avant J, sans les null", () => {
    const J = "2026-09-01";
    const history = [
      day(addDays(J, -91), 111), // trop ancien
      day(addDays(J, -90), 222), // premier jour de la fenêtre
      day(addDays(J, -1), 333),
      day(addDays(J, -2), null), // absent : ignoré
      day(J, 444), // J lui-même : exclu
      day(addDays(J, 1), 555), // futur : exclu
    ];
    expect(referenceValues("steps", J, history).sort()).toEqual([222, 333]);
  });
});

describe("normalizeDay", () => {
  it("utilise les valeurs par défaut sous 14 points de référence", () => {
    const J = "2026-07-01";
    const history = before(J, MIN_REFERENCE_POINTS - 1);
    const n = normalizeDay(day(J, 8000), history);
    expect(n.steps.basis).toBe("defaults");
    expect(n.steps.value).toBeCloseTo(0.5);
  });

  it("passe au rang percentile à partir de 14 points", () => {
    const J = "2026-07-01";
    const history = before(J, MIN_REFERENCE_POINTS); // 1000 … 14000
    const n = normalizeDay(day(J, 7500), history);
    expect(n.steps.basis).toBe("percentile");
    expect(n.steps.value).toBeCloseTo(7 / 14);
  });

  it("garde null pour une mesure absente, et 0 n'est pas null", () => {
    const J = "2026-07-01";
    const history = before(J, 30);
    expect(normalizeDay(day(J, null), history).steps.value).toBeNull();
    expect(normalizeDay(day(J, 0), history).steps.value).toBe(0);
  });

  it("n'est pas modifiée par des jours postérieurs", () => {
    const J = "2026-07-01";
    const history = before(J, 40);
    const future = Array.from({ length: 30 }, (_, i) => day(addDays(J, i + 1), 99_999, 900, 50));
    expect(normalizeDay(day(J, 12000), [...history, ...future])).toEqual(normalizeDay(day(J, 12000), history));
  });
});
