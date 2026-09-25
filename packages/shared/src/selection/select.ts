/**
 * Choix déterministe de la technique de chaque jour (moteur v2). Pur, sans dépendance :
 * utilisé tel quel par le navigateur (page du jour, galerie) et par l'API (gel des styles).
 *
 * Règles (toutes les valeurs sont dans `constants.ts`) :
 *  1. K = pas × 1000 + minuteDuRéveil × 10 + commits (+ température si connue) ; u = frac(K × φ⁻¹).
 *  2. Poids de base selon la tranche de pas (centile sur les 90 jours précédents).
 *  3. Ajustements multiplicatifs (sommeil, commits, météo).
 *  4. Exclusions : styles d'hier et d'avant-hier, et toute la famille d'hier.
 *  5. Tirage : cumul des poids restants dans l'ordre fixe de `STYLES`, point = u × total.
 *  6. Chaîne : jour par jour depuis l'origine ; un style figé n'est jamais recalculé.
 *
 * Le résultat de chaque jour est accompagné de son explication complète (`SelectionExplain`),
 * sérialisable en JSON : l'API la stocke avec le style figé, la page du jour en fait la fiche.
 */
import { addDays, daysBetween } from "./calendar";
import {
  ADJUSTMENTS,
  BASE_WEIGHTS,
  EXCLUSIONS,
  FAMILIES,
  KEY,
  MISSING_STEPS_BAND,
  NORMALIZATION,
  SELECTION_VERSION,
  STEP_BANDS,
  STYLES,
  type AdjustmentRule,
  type BandId,
  type FamilyId,
  type StyleId,
} from "./constants";
import { percentileOf, type NormMetric, type Percentile } from "./norms";
import { wakeMinute } from "./wake";

/** Ce que la sélection lit d'une journée. Les champs météo sont optionnels (données à venir). */
export interface SelectionDay {
  date: string;
  steps: number | null;
  sleep_minutes: number | null;
  sleep_end: string | null;
  commits: number | null;
  /** Température maximale du jour, °C. */
  temp_max?: number | null | undefined;
  /** Cumul de pluie du jour, mm. */
  precip_mm?: number | null | undefined;
  /** Vent maximal du jour, km/h. */
  wind_max_kmh?: number | null | undefined;
}

export type ExclusionReason = "hier" | "avant-hier" | "famille d'hier";

export interface KeyTerm {
  id: "steps" | "wake" | "commits" | "temp";
  /** Valeur brute (null = absente, comptée 0). Pour `temp` : °C. */
  raw: number | null;
  /** Valeur utilisée dans K (0 si absente ; dixièmes de degré arrondis pour `temp`). */
  used: number;
  factor: number;
  /** used × factor. */
  value: number;
}

export interface Candidate {
  style: StyleId;
  family: FamilyId;
  base: number;
  /** Produit des ajustements appliqués à ce style (1 si aucun). */
  factor: number;
  /** base × factor (0 si exclu). */
  weight: number;
  excluded: boolean;
  /** Chance finale 0–1 (0 si exclu). */
  chance: number;
  /** Intervalle [from, to[ du style sur l'axe cumulé (0–total). */
  from: number;
  to: number;
}

export interface SelectionExplain {
  selection_version: number;
  date: string;
  origin: string;
  /** Numéro du jour depuis l'origine (0 le premier jour). */
  day_index: number;
  inputs: {
    steps: number | null;
    sleep_minutes: number | null;
    wake_minute: number | null;
    commits: number | null;
    temp_max: number | null;
    precip_mm: number | null;
    wind_max_kmh: number | null;
  };
  /** Aucune donnée personnelle ce jour-là : K = numéro du jour. */
  no_data: boolean;
  key: { mode: "data" | "day_index"; terms: KeyTerm[]; K: number; golden: number; u: number };
  percentiles: { steps: Percentile; sleep: Percentile; commits: Percentile };
  band: { id: BandId; label: string; percentile: number | null };
  adjustments: {
    id: string;
    label: string;
    metric: AdjustmentRule["metric"];
    value: number;
    comparison: "<" | ">" | "≥";
    threshold: number;
    factors: { style: StyleId; factor: number }[];
  }[];
  /** Règles non appliquées faute de donnée (jamais parce que « absent = bas »). */
  missing_adjustments: { id: string; label: string; metric: AdjustmentRule["metric"] }[];
  previous: { date: string; style: StyleId; frozen: boolean }[];
  exclusions: { style: StyleId; reason: ExclusionReason; date: string }[];
  candidates: Candidate[];
  total: number;
  point: number;
  style: StyleId;
  family: FamilyId;
}

export function familyOf(style: StyleId): FamilyId {
  for (const [family, styles] of Object.entries(FAMILIES) as [FamilyId, readonly StyleId[]][]) {
    if (styles.includes(style)) return family;
  }
  throw new Error(`style sans famille : ${style}`);
}

export function isStyleId(s: unknown): s is StyleId {
  return typeof s === "string" && (STYLES as readonly string[]).includes(s);
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Aucune donnée personnelle : pas, sommeil, réveil et commits tous absents (la météo ne compte pas). */
export function hasNoData(day: SelectionDay | null | undefined): boolean {
  return !day || (day.steps === null && day.sleep_minutes === null && day.sleep_end === null && day.commits === null);
}

/** Nombre clé et u d'une journée. */
export function keyOf(day: SelectionDay | null, dayIndex: number): SelectionExplain["key"] {
  if (hasNoData(day)) {
    return { mode: "day_index", terms: [], K: dayIndex, golden: KEY.golden, u: frac(dayIndex * KEY.golden) };
  }
  const d = day!;
  const wake = wakeMinute(d.sleep_end);
  const term = (id: KeyTerm["id"], raw: number | null, used: number, factor: number): KeyTerm => ({ id, raw, used, factor, value: used * factor });
  // Seule exception à « absent ≠ 0 » : dans K, et seulement dans K, une valeur absente compte 0
  // (règle validée). Elle reste `null` dans `raw` et partout ailleurs.
  const inKey = (v: number | null) => (v === null ? 0 : v);
  const terms: KeyTerm[] = [
    term("steps", d.steps, inKey(d.steps), KEY.stepsFactor),
    term("wake", wake, inKey(wake), KEY.wakeFactor),
    term("commits", d.commits, inKey(d.commits), KEY.commitsFactor),
  ];
  const temp = d.temp_max ?? null;
  if (temp !== null && Number.isFinite(temp)) terms.push(term("temp", temp, Math.round(temp * 10), KEY.tempTenthsFactor));
  const K = terms.reduce((s, t) => s + t.value, 0);
  return { mode: "data", terms, K, golden: KEY.golden, u: frac(K * KEY.golden) };
}

export function bandOf(stepsPercentile: number | null): { id: BandId; label: string } {
  if (stepsPercentile === null) {
    const band = STEP_BANDS.find((b) => b.id === MISSING_STEPS_BAND)!;
    return { id: band.id, label: band.label };
  }
  const band = STEP_BANDS.find((b) => b.below === null || stepsPercentile < b.below)!;
  return { id: band.id, label: band.label };
}

export interface SelectDayInput {
  date: string;
  /** La journée, ou null si elle est absente de la base (traitée comme tout à null). */
  day: SelectionDay | null;
  percentiles: { steps: Percentile; sleep: Percentile; commits: Percentile };
  origin: string;
  /** Styles des jours précédents, hier d'abord. */
  previous: readonly { date: string; style: StyleId; frozen: boolean }[];
}

/** Choisit le style d'un jour, connaissant ses centiles et les styles des jours précédents. */
export function selectDay(input: SelectDayInput): SelectionExplain {
  const { date, day, percentiles, origin } = input;
  const dayIndex = daysBetween(origin, date);
  const key = keyOf(day, dayIndex);
  const band = bandOf(percentiles.steps.value);

  const inputs: SelectionExplain["inputs"] = {
    steps: day?.steps ?? null,
    sleep_minutes: day?.sleep_minutes ?? null,
    wake_minute: wakeMinute(day?.sleep_end ?? null),
    commits: day?.commits ?? null,
    temp_max: day?.temp_max ?? null,
    precip_mm: day?.precip_mm ?? null,
    wind_max_kmh: day?.wind_max_kmh ?? null,
  };

  // Ajustements.
  const factor = new Map<StyleId, number>(STYLES.map((s) => [s, 1]));
  const adjustments: SelectionExplain["adjustments"] = [];
  const missing_adjustments: SelectionExplain["missing_adjustments"] = [];
  for (const rule of ADJUSTMENTS) {
    if (!rule.enabled) continue;
    const value =
      rule.metric === "sleep" ? percentiles.sleep.value
      : rule.metric === "commits" ? percentiles.commits.value
      : rule.metric === "precip_mm" ? inputs.precip_mm
      : inputs.wind_max_kmh;
    if (value === null || !Number.isFinite(value)) {
      missing_adjustments.push({ id: rule.id, label: rule.label, metric: rule.metric });
      continue;
    }
    let comparison: "<" | ">" | "≥" | null = null;
    let threshold = 0;
    if (rule.below !== undefined && value < rule.below) [comparison, threshold] = ["<", rule.below];
    else if (rule.above !== undefined && value > rule.above) [comparison, threshold] = [">", rule.above];
    else if (rule.atLeast !== undefined && value >= rule.atLeast) [comparison, threshold] = ["≥", rule.atLeast];
    if (comparison === null) continue;
    const factors = STYLES.filter((s) => rule.factors[s] !== undefined).map((s) => ({ style: s, factor: rule.factors[s]! }));
    for (const f of factors) factor.set(f.style, factor.get(f.style)! * f.factor);
    adjustments.push({ id: rule.id, label: rule.label, metric: rule.metric, value, comparison, threshold, factors });
  }

  // Exclusions : hier, avant-hier, puis la famille d'hier.
  const previous = input.previous.slice(0, EXCLUSIONS.previousDays);
  const excluded = new Map<StyleId, { reason: ExclusionReason; date: string }>();
  previous.forEach((p, i) => {
    if (!excluded.has(p.style)) excluded.set(p.style, { reason: i === 0 ? "hier" : "avant-hier", date: p.date });
  });
  const yesterday = previous[0];
  if (EXCLUSIONS.familyOfYesterday && yesterday) {
    for (const s of FAMILIES[familyOf(yesterday.style)]) {
      if (!excluded.has(s)) excluded.set(s, { reason: "famille d'hier", date: yesterday.date });
    }
  }
  const exclusions = STYLES.filter((s) => excluded.has(s)).map((s) => ({ style: s, ...excluded.get(s)! }));

  // Tirage.
  const base = BASE_WEIGHTS[band.id];
  let total = 0;
  const candidates: Candidate[] = STYLES.map((style) => {
    const isOut = excluded.has(style);
    const weight = isOut ? 0 : base[style] * factor.get(style)!;
    const c: Candidate = { style, family: familyOf(style), base: base[style], factor: factor.get(style)!, weight, excluded: isOut, chance: 0, from: total, to: total + weight };
    total += weight;
    return c;
  });
  for (const c of candidates) c.chance = total > 0 ? c.weight / total : 0;
  const point = key.u * total;
  const live = candidates.filter((c) => !c.excluded && c.weight > 0);
  if (live.length === 0) throw new Error(`aucun style possible pour ${date}`);
  const chosen = live.find((c) => point < c.to) ?? live[live.length - 1]!;

  return {
    selection_version: SELECTION_VERSION,
    date,
    origin,
    day_index: dayIndex,
    inputs,
    no_data: key.mode === "day_index",
    key,
    percentiles,
    band: { ...band, percentile: percentiles.steps.value },
    adjustments,
    missing_adjustments,
    previous: previous.map((p) => ({ ...p })),
    exclusions,
    candidates,
    total,
    point,
    style: chosen.style,
    family: chosen.family,
  };
}

/* ───────────────────────────────── Chaîne ───────────────────────────────── */

export interface ChainOptions {
  /** Journées connues (n'importe quel ordre ; les jours absents sont traités comme tout à null). */
  days: readonly SelectionDay[];
  /** Dernier jour voulu (inclus). */
  to: string;
  /** Premier jour renvoyé (inclus). Défaut : l'origine. */
  from?: string | undefined;
  /** Premier jour de la chaîne. Défaut : le premier jour de `days`. */
  origin?: string | undefined;
  /** Styles figés : jamais recalculés, ils servent aux exclusions des jours suivants. */
  frozen?: ReadonlyMap<string, StyleId> | undefined;
}

export interface ChainEntry {
  date: string;
  style: StyleId;
  frozen: boolean;
  /** Explication du calcul, `null` pour un jour figé (l'API garde celle du jour du gel). */
  explain: SelectionExplain | null;
}

export interface ChainResult {
  origin: string;
  /** Jour à partir duquel le calcul a vraiment démarré. */
  start: string;
  /** "frozen" : repris derrière deux jours figés consécutifs ; "origin" : depuis l'origine. */
  anchored: "origin" | "frozen";
  /** Jours de `from` à `to`, dans l'ordre. */
  entries: ChainEntry[];
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Journées indexées par numéro de jour : la fenêtre de référence se parcourt sans calcul de date. */
export class DayIndex {
  private readonly byNum = new Map<number, SelectionDay>();
  constructor(days: Iterable<SelectionDay>) {
    for (const d of days) this.byNum.set(dayNumber(d.date), d);
  }
  get(date: string): SelectionDay | undefined {
    return this.byNum.get(dayNumber(date));
  }
  /** Valeurs non nulles de `metric` sur les 90 jours strictement avant `date`. */
  reference(metric: NormMetric, date: string): number[] {
    const n = dayNumber(date);
    const out: number[] = [];
    for (let i = n - NORMALIZATION.windowDays; i < n; i++) {
      const v = this.byNum.get(i)?.[metric];
      if (v !== null && v !== undefined) out.push(v);
    }
    return out;
  }
}

/** Centiles d'un jour par rapport aux 90 jours qui le précèdent (jour exclu). */
export function percentilesFor(index: DayIndex, date: string): SelectDayInput["percentiles"] {
  const day = index.get(date) ?? null;
  return {
    steps: percentileOf("steps", day?.steps ?? null, index.reference("steps", date)),
    sleep: percentileOf("sleep_minutes", day?.sleep_minutes ?? null, index.reference("sleep_minutes", date)),
    commits: percentileOf("commits", day?.commits ?? null, index.reference("commits", date)),
  };
}

/**
 * Calcule la chaîne jusqu'à `to`. Le style d'un jour ne dépend que de ses données, de ses
 * 90 jours de référence et des styles des deux jours précédents : dès que deux jours
 * consécutifs sont figés, le calcul peut repartir de là (c'est ce qui permet au navigateur
 * de ne charger que quelques mois d'historique).
 */
export function computeChain(options: ChainOptions): ChainResult {
  const index = new DayIndex(options.days);
  const sorted = options.days.map((d) => d.date).sort();
  let origin = options.origin ?? sorted[0] ?? options.from ?? options.to;
  const from = options.from ?? origin;
  if (from < origin) origin = from;
  const frozen = new Map<string, StyleId>();
  for (const [date, style] of options.frozen ?? []) if (isStyleId(style)) frozen.set(date, style);

  // Point de départ : le jour le plus récent ≤ from dont les deux veilles sont figées.
  let start = from;
  let anchored: ChainResult["anchored"] = "origin";
  while (start > origin) {
    const d1 = addDays(start, -1);
    const d2 = addDays(start, -2);
    if (frozen.has(d1) && (d2 < origin || frozen.has(d2))) {
      anchored = "frozen";
      break;
    }
    start = d1;
  }

  const history: { date: string; style: StyleId; frozen: boolean }[] = [];
  if (anchored === "frozen") {
    for (const d of [addDays(start, -2), addDays(start, -1)]) {
      if (d >= origin) history.push({ date: d, style: frozen.get(d)!, frozen: true });
    }
  }
  const entries: ChainEntry[] = [];
  for (let date = start; date <= options.to; date = addDays(date, 1)) {
    let entry: ChainEntry;
    const fixed = frozen.get(date);
    if (fixed) {
      entry = { date, style: fixed, frozen: true, explain: null };
    } else {
      const previous = history.slice(-EXCLUSIONS.previousDays).reverse();
      const explain = selectDay({ date, day: index.get(date) ?? null, percentiles: percentilesFor(index, date), origin, previous });
      entry = { date, style: explain.style, frozen: false, explain };
    }
    history.push({ date, style: entry.style, frozen: entry.frozen });
    if (history.length > EXCLUSIONS.previousDays) history.shift();
    if (date >= from) entries.push(entry);
  }
  return { origin, start, anchored, entries };
}
