/**
 * Construit l'entrée d'une technique (`TechniqueInput`) à partir d'une journée et de son
 * historique. Données optionnelles (météo, pas horaires) : prises si elles existent, sinon
 * `null`, et chaque technique utilise alors les valeurs de repli de `FALLBACKS`.
 */
import type { StyleId } from "@sillage/shared";
import type { DayInput } from "../engine/day";
import { emptyDay } from "../engine/day";
import { normalizeDay } from "../engine/normalize";
import { seedFromDate } from "../engine/random";
import { dayLengthHours, moonPhase, paletteFor } from "./palette";
import type { TechniqueInput, WeatherInput } from "./types";

/**
 * Une journée telle que le moteur v2 sait la lire : `DayInput` + champs optionnels à venir
 * (météo, pas horaires). Tant que l'API ne les fournit pas, ils sont absents.
 */
export type DayV2 = DayInput & {
  temp_min?: number | null;
  temp_max?: number | null;
  precip_mm?: number | null;
  wind_max_kmh?: number | null;
  wind_dir_deg?: number | null;
  cloud_cover?: number | null;
  hourly_steps?: number[] | null;
};

/**
 * Valeurs de repli documentées, utilisées quand une donnée optionnelle manque :
 * une journée de Paris « moyenne », jamais affichée comme mesurée (la fiche dit « repli »).
 */
export const FALLBACKS = {
  /** Vent d'ouest-sud-ouest, dominant à Paris. */
  windDirDeg: 250,
  windKmh: 12,
  cloud: 0.5,
  tempMax: 16,
  precipMm: 0,
  /**
   * Profil horaire type (réveil, midi, soirée) : quand les pas horaires manquent, le total
   * du jour est réparti selon cette forme. Somme quelconque, seule la forme compte.
   */
  hourlyShape: [0, 0, 0, 0, 0, 0, 0, 0.2, 1.4, 0.9, 0.4, 0.5, 1.3, 0.8, 0.3, 0.3, 0.5, 0.9, 1.6, 1.1, 0.6, 0.3, 0.1, 0],
} as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function weatherOf(day: DayV2): WeatherInput | null {
  const w: WeatherInput = {
    temp_min: num(day.temp_min),
    temp_max: num(day.temp_max),
    precip_mm: num(day.precip_mm),
    wind_kmh: num(day.wind_max_kmh),
    wind_dir_deg: num(day.wind_dir_deg),
    cloud: num(day.cloud_cover),
  };
  return Object.values(w).every((v) => v === null) ? null : w;
}

/** Pas horaires : la donnée si elle existe (24 valeurs), sinon le total réparti selon `FALLBACKS.hourlyShape`. */
export function hourlyOrFallback(input: Pick<TechniqueInput, "hourlySteps" | "day">): number[] {
  if (input.hourlySteps && input.hourlySteps.length === 24) return input.hourlySteps;
  const total = input.day.steps ?? 0;
  const sum = FALLBACKS.hourlyShape.reduce<number>((a, b) => a + b, 0);
  return FALLBACKS.hourlyShape.map((v) => Math.round((v / sum) * total));
}

/** Météo avec repli champ par champ. `measured` dit si la valeur vient de la donnée. */
export function weatherOrFallback(w: WeatherInput | null) {
  const pick = (v: number | null | undefined, fallback: number) => ({ value: v ?? fallback, measured: v !== null && v !== undefined });
  return {
    windDirDeg: pick(w?.wind_dir_deg, FALLBACKS.windDirDeg),
    windKmh: pick(w?.wind_kmh, FALLBACKS.windKmh),
    cloud: pick(w?.cloud, FALLBACKS.cloud),
    tempMax: pick(w?.temp_max, FALLBACKS.tempMax),
    precipMm: pick(w?.precip_mm, FALLBACKS.precipMm),
  };
}

/**
 * Entrée d'une technique pour `date`. `history` : n'importe quels jours (seuls les 90 jours
 * avant `date` comptent, comme en v1) ; une date absente est une journée tout à `null`.
 */
export function buildTechniqueInput(date: string, history: readonly DayV2[], style: StyleId): TechniqueInput {
  const day: DayV2 = history.find((d) => d.date === date) ?? emptyDay(date);
  const v1Norms = normalizeDay(day, history);
  const seed = seedFromDate(date);
  const weather = weatherOf(day);
  const norms = { steps: v1Norms.steps.value, sleep: v1Norms.sleep_minutes.value, commits: v1Norms.commits.value };
  const hourly = day.hourly_steps && day.hourly_steps.length === 24 ? [...day.hourly_steps] : null;
  return {
    date,
    seed,
    style,
    day: { date: day.date, steps: day.steps, sleep_minutes: day.sleep_minutes, sleep_start: day.sleep_start, sleep_end: day.sleep_end, commits: day.commits },
    norms,
    v1Norms,
    palette: paletteFor({ date, seed, sleep: norms.sleep, tempMax: weather?.temp_max ?? null }),
    weather,
    hourlySteps: hourly,
    moon: moonPhase(date),
    dayLengthHours: dayLengthHours(date),
  };
}
