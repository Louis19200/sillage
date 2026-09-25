/**
 * La journée commune à toutes les esquisses : 14 juillet 2026 des fixtures
 * (pas, sommeil, commits), plus une météo et des pas horaires INVENTÉS pour
 * l'exercice (ces données n'existent pas encore dans Sillage).
 */
import days from "@sillage/shared/fixtures/days.json";
import { createRng, normalizeDay, seedFromDate, type DayInput, type Rng } from "../src/engine";

export const DATE = "2026-07-14";
const history = days as unknown as DayInput[];
export const day = history.find((d) => d.date === DATE)!;
const norms = normalizeDay(day, history);

/** Données normalisées 0..1 par rapport à tes habitudes. */
export const n = {
  steps: norms.steps.value ?? 0.5,
  sleep: norms.sleep_minutes.value ?? 0.5,
  commits: norms.commits.value ?? 0.5,
};

/** Météo inventée : journée chaude, averse l'après-midi, vent d'ouest-sud-ouest. */
export const weather = { tempMin: 19, tempMax: 28, precipMm: 1.8, windKmh: 22, windDirDeg: 250, cloud: 0.45 };

/** Phase de lune réelle du jour (0 = nouvelle, 0.5 = pleine). */
export const moon = (() => {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const t = (Date.parse(`${DATE}T12:00:00Z`) - ref) / 86_400_000;
  return ((t / 29.530588853) % 1 + 1) % 1;
})();

/** Pas par heure (inventés, somment au total réel) : marche le matin, midi, soirée. */
export const hourly = (() => {
  const shape = [0, 0, 0, 0, 0, 0, 0, 0.2, 1.4, 0.9, 0.4, 0.5, 1.3, 0.8, 0.3, 0.3, 0.5, 0.9, 1.6, 1.1, 0.6, 0.3, 0.1, 0];
  const sum = shape.reduce((a, b) => a + b, 0);
  return shape.map((v) => Math.round((v / sum) * (day.steps ?? 0)));
})();

/** Palette commune (été chaud, longue nuit) : seule la technique change d'une esquisse à l'autre. */
export const palette = {
  paper: "#f2ece1",
  ink: "#1d1f2b",
  night: "#14213d",
  colors: ["#1f5f6b", "#e07a4f", "#f2b84b", "#8fb39a", "#b8413c"],
};

export const seed = seedFromDate(DATE);
export const rngFor = (name: string): Rng => createRng(seed).fork(name);

export type Sketch = (ctx: CanvasRenderingContext2D, S: number) => void | Promise<void>;
