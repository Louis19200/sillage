/**
 * Centiles « par rapport à mes habitudes », identiques à la v1 (art/src/engine/normalize.ts) :
 * rang percentile parmi les valeurs non nulles des 90 jours qui précèdent le jour (jour exclu),
 * courbe par défaut sous 14 points. `null` reste `null`.
 */
import { NORMALIZATION } from "./constants";

export type NormMetric = keyof typeof NORMALIZATION.defaults;

export interface Percentile {
  /** 0–1, ou null si la mesure du jour est absente. */
  value: number | null;
  basis: "percentile" | "defaults";
  /** Nombre de jours de référence trouvés dans les 90 jours précédents. */
  reference_size: number;
}

export function percentileRank(value: number, reference: readonly number[]): number {
  if (reference.length === 0) throw new Error("référence vide");
  let below = 0;
  let equal = 0;
  for (const r of reference) {
    if (r < value) below++;
    else if (r === value) equal++;
  }
  return (below + equal / 2) / reference.length;
}

export function defaultNorm(metric: NormMetric, value: number): number {
  if (value <= 0) return 0;
  const { median, steepness } = NORMALIZATION.defaults[metric];
  return 1 / (1 + Math.pow(median / value, steepness));
}

export function percentileOf(metric: NormMetric, value: number | null, reference: readonly number[]): Percentile {
  const basis = reference.length >= NORMALIZATION.minPoints ? "percentile" : "defaults";
  if (value === null) return { value: null, basis, reference_size: reference.length };
  return {
    value: basis === "percentile" ? percentileRank(value, reference) : defaultNorm(metric, value),
    basis,
    reference_size: reference.length,
  };
}
