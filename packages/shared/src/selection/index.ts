/**
 * Sélection de la technique du jour (moteur v2), partagée par le navigateur et l'API.
 * Réglages : `constants.ts`. Algorithme : `select.ts`.
 */
export * from "./constants";
export { addDays, daysBetween } from "./calendar";
export { wakeMinute, formatClock } from "./wake";
export { percentileRank, defaultNorm, percentileOf, type Percentile, type NormMetric } from "./norms";
export {
  selectDay,
  computeChain,
  percentilesFor,
  DayIndex,
  keyOf,
  bandOf,
  familyOf,
  isStyleId,
  hasNoData,
  type SelectionDay,
  type SelectionExplain,
  type SelectDayInput,
  type ChainOptions,
  type ChainEntry,
  type ChainResult,
  type Candidate,
  type KeyTerm,
  type ExclusionReason,
} from "./select";
