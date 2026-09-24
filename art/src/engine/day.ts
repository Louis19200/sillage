import type { DailyMetrics } from "@sillage/shared";

/** Ce dont le moteur a besoin d'une journée (sous-ensemble de `DailyMetrics`). */
export type DayInput = Pick<
  DailyMetrics,
  "date" | "steps" | "sleep_minutes" | "sleep_start" | "sleep_end" | "commits"
>;

/** Une journée absente de la base : tout est `null` (jamais 0). */
export function emptyDay(date: string): DayInput {
  return { date, steps: null, sleep_minutes: null, sleep_start: null, sleep_end: null, commits: null };
}
