/**
 * Ce que la galerie sait d'une journée avant de la composer : a-t-elle des données, et
 * quelle empreinte ont les entrées de son œuvre (J + les 90 jours avant) pour le cache.
 */
import { addDays, cyrb53, REFERENCE_WINDOW_DAYS, type DayInput } from "../../engine";

/** Présente en base avec au moins une métrique mesurée (0 compte comme mesuré). */
export function hasData(day: DayInput | undefined): boolean {
  return day !== undefined && (day.steps !== null || day.sleep_minutes !== null || day.commits !== null);
}

/** Uniquement les champs lus par le moteur (pas `updated_at`), pour des empreintes stables. */
export function toDayInput(d: DayInput): DayInput {
  return {
    date: d.date,
    steps: d.steps,
    sleep_minutes: d.sleep_minutes,
    sleep_start: d.sleep_start,
    sleep_end: d.sleep_end,
    commits: d.commits,
  };
}

function dayString(d: DayInput): string {
  return `${d.date}|${d.steps}|${d.sleep_minutes}|${d.sleep_start}|${d.sleep_end}|${d.commits}`;
}

/**
 * Empreinte des entrées de l'œuvre de chaque date : la journée J et les jours de
 * [J-90, J[ présents dans `history`. Deux dates dont l'empreinte n'a pas changé
 * donnent la même Scene (le moteur est déterministe), donc la même miniature.
 */
export function inputFingerprints(dates: readonly string[], history: readonly DayInput[]): Map<string, string> {
  const hashes = new Map(history.map((d) => [d.date, cyrb53(dayString(d)).toString(36)]));
  const out = new Map<string, string>();
  for (const date of dates) {
    const parts: string[] = [];
    for (let i = -REFERENCE_WINDOW_DAYS; i <= 0; i++) {
      const h = hashes.get(addDays(date, i));
      if (h) parts.push(h);
    }
    out.set(date, cyrb53(`${date}:${parts.join(",")}`).toString(36));
  }
  return out;
}
