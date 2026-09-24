/**
 * Normalisation 0–1 « par rapport à mes habitudes ». Fonctions pures.
 *
 * Règles :
 * - La référence d'un jour J = les valeurs non `null` des 90 jours qui PRÉCÈDENT J
 *   (J exclu). Ajouter des jours après J ne peut donc pas changer l'œuvre de J.
 * - Valeur = rang percentile dans la référence (robuste aux valeurs extrêmes) :
 *   (nb de valeurs strictement inférieures + ½ nb de valeurs égales) / n.
 * - Moins de 14 points de référence : courbe par défaut documentée dans `DEFAULTS`.
 * - `null` reste `null` : une donnée absente n'est jamais ramenée à 0.
 */
import type { DayInput } from "./day";
import { addDays } from "./dates";

export type Metric = "steps" | "sleep_minutes" | "commits";
export const METRICS: readonly Metric[] = ["steps", "sleep_minutes", "commits"];

export const REFERENCE_WINDOW_DAYS = 90;
export const MIN_REFERENCE_POINTS = 14;

/**
 * Habitudes par défaut, utilisées tant qu'il y a moins de 14 points de référence.
 * La courbe est une sigmoïde sur le rapport à la médiane :
 *   norm(v) = 1 / (1 + (median / v)^steepness), norm(0) = 0,
 * donc norm(median) = 0,5. `steepness` règle la sensibilité autour de l'habitude.
 */
export const DEFAULTS: Record<Metric, { median: number; steepness: number }> = {
  /** 8 000 pas : 4 000 → 0,20 ; 16 000 → 0,80. */
  steps: { median: 8000, steepness: 2 },
  /** 7 h 30 de sommeil : 6 h → 0,14 ; 9 h → 0,81. */
  sleep_minutes: { median: 450, steepness: 8 },
  /** 4 commits : 1 → 0,11 ; 12 → 0,84. */
  commits: { median: 4, steepness: 1.5 },
};

export type NormBasis = "percentile" | "defaults";

export interface MetricNorm {
  /** Valeur normalisée 0–1, ou `null` si la mesure est absente. */
  value: number | null;
  basis: NormBasis;
  /** Nombre de points de référence trouvés dans les 90 jours précédents. */
  referenceSize: number;
}

export type Norms = Record<Metric, MetricNorm>;

/** Rang percentile de `value` dans `reference` (non vide), dans [0, 1]. */
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

/** Courbe par défaut (voir `DEFAULTS`). */
export function defaultNorm(metric: Metric, value: number): number {
  if (value <= 0) return 0;
  const { median, steepness } = DEFAULTS[metric];
  return 1 / (1 + Math.pow(median / value, steepness));
}

/** Valeurs non `null` de `metric` sur les 90 jours strictement avant `date`. */
export function referenceValues(
  metric: Metric,
  date: string,
  history: readonly DayInput[],
): number[] {
  const from = addDays(date, -REFERENCE_WINDOW_DAYS);
  const out: number[] = [];
  for (const d of history) {
    // Comparaison lexicographique valide pour YYYY-MM-DD.
    if (d.date >= from && d.date < date) {
      const v = d[metric];
      if (v !== null) out.push(v);
    }
  }
  return out;
}

export function normalizeMetric(
  metric: Metric,
  value: number | null,
  reference: readonly number[],
): MetricNorm {
  const basis: NormBasis = reference.length >= MIN_REFERENCE_POINTS ? "percentile" : "defaults";
  const referenceSize = reference.length;
  if (value === null) return { value: null, basis, referenceSize };
  const v = basis === "percentile" ? percentileRank(value, reference) : defaultNorm(metric, value);
  return { value: v, basis, referenceSize };
}

/**
 * Normalise les trois métriques d'une journée. `history` peut contenir n'importe
 * quels jours (y compris J et des jours futurs) : seuls les 90 jours avant J comptent.
 */
export function normalizeDay(day: DayInput, history: readonly DayInput[]): Norms {
  const norms = {} as Norms;
  for (const metric of METRICS) {
    norms[metric] = normalizeMetric(metric, day[metric], referenceValues(metric, day.date, history));
  }
  return norms;
}
