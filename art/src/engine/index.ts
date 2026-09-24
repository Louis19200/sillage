/**
 * API publique du moteur (sans p5). La galerie importe d'ici ;
 * le rendu p5 est dans `./render-p5` pour que les modules purs restent utilisables
 * en Node (tests, exports SVG) sans charger p5.
 */
import { emptyDay, type DayInput } from "./day";
import { normalizeDay } from "./normalize";
import { composeDay } from "./compose";
import { seedFromDate } from "./random";
import type { Scene } from "./scene";

export { composeDay } from "./compose";
export { emptyDay, type DayInput } from "./day";
export {
  normalizeDay,
  normalizeMetric,
  percentileRank,
  defaultNorm,
  referenceValues,
  DEFAULTS,
  REFERENCE_WINDOW_DAYS,
  MIN_REFERENCE_POINTS,
  METRICS,
  type Metric,
  type MetricNorm,
  type Norms,
  type NormBasis,
} from "./normalize";
export { seedFromDate, cyrb53, mulberry32, createRng, type Rng } from "./random";
export { catmullRomToBezier, type BezierPath, type Pt } from "./geometry";
export { addDays, daysBetween, isIsoDate } from "./dates";
export * from "./scene";

/**
 * Raccourci : l'œuvre d'une date à partir de l'historique disponible.
 * `history` peut contenir n'importe quels jours ; seuls J et les 90 jours avant J comptent.
 * Une date absente de `history` est rendue comme une journée entièrement `null`.
 */
export function composeForDate(date: string, history: readonly DayInput[]): Scene {
  const day = history.find((d) => d.date === date) ?? emptyDay(date);
  return composeDay(day, normalizeDay(day, history), seedFromDate(date));
}
