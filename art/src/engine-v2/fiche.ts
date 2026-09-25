/**
 * Fiche « Comment cette œuvre a été choisie » : modèle pur (textes et nombres déjà mis en forme),
 * testé en Node. La page du jour en fait une section repliable, la galerie un résumé compact.
 * Rien ici ne recalcule : tout vient de `SelectionExplain` (sélection) et de `explain()` (technique).
 */
import {
  BASE_WEIGHTS,
  FAMILY_NAMES,
  formatClock,
  KEY,
  STEP_BANDS,
  STYLE_NAMES,
  STYLES,
  type SelectionExplain,
  type StyleId,
} from "@sillage/shared";
import { explainPalette } from "./palette";
import type { DaySelection } from "./select";
import type { ExplainLine, Technique, TechniqueInput } from "./types";

const nf = (min: number, max: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
const int = (n: number) => nf(0, 0).format(n).replace("-", "−");
const dec = (n: number, d = 2) => nf(0, d).format(n).replace("-", "−");
const pct = (x: number) => `${nf(1, 1).format(x * 100)} %`;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${d === 1 ? "1er" : d} ${MONTHS[m - 1]} ${y}`;
}

function sleepText(min: number | null): string {
  return min === null ? "non mesuré" : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

const REASON: Record<string, string> = {
  hier: "style d'hier",
  "avant-hier": "style d'avant-hier",
  "famille d'hier": "même famille qu'hier",
};

export interface FicheRow {
  label: string;
  value: string;
  note?: string;
}

export interface ChanceBar {
  style: StyleId;
  name: string;
  family: string;
  weight: string;
  chance: number;
  chanceText: string;
  excluded: boolean;
  reason: string | null;
  chosen: boolean;
}

export interface FicheModel {
  styleName: string;
  familyName: string;
  process: string;
  ported: boolean;
  status: string;
  frozen: boolean;
  /** false : jour figé dont l'API n'a pas gardé le calcul (seul le style est connu). */
  hasDetail: boolean;
  raw: FicheRow[];
  key: { formula: string; substituted: string; K: string; uFormula: string; u: string; note: string | null } | null;
  band: { centile: string; label: string; table: { name: string; weight: string; highlight: boolean }[] } | null;
  adjustments: { label: string; reason: string; effects: string }[];
  missingAdjustments: string[];
  exclusions: { name: string; reason: string }[];
  chances: ChanceBar[];
  draw: { formula: string; result: string } | null;
  technique: ExplainLine[];
  palette: ExplainLine[] | null;
}

function metricLabel(m: string): string {
  return m === "sleep" ? "sommeil" : m === "commits" ? "commits" : m === "precip_mm" ? "pluie" : "vent";
}

function adjustmentReason(a: SelectionExplain["adjustments"][number]): string {
  if (a.metric === "sleep" || a.metric === "commits") {
    return `${metricLabel(a.metric)} au ${Math.round(a.value * 100)}ᵉ centile (${a.comparison} ${Math.round(a.threshold * 100)}ᵉ)`;
  }
  const unit = a.metric === "precip_mm" ? "mm" : "km/h";
  return `${metricLabel(a.metric)} ${dec(a.value, 1)} ${unit} (${a.comparison} ${dec(a.threshold, 1)} ${unit})`;
}

function rawRows(e: SelectionExplain | null, input: TechniqueInput): FicheRow[] {
  const d = input.day;
  const wake = e?.inputs.wake_minute ?? null;
  const rows: FicheRow[] = [
    { label: "Pas", value: d.steps === null ? "non mesuré" : int(d.steps), note: e ? centileNote(e.percentiles.steps) : undefined },
    { label: "Sommeil", value: sleepText(d.sleep_minutes), note: e ? centileNote(e.percentiles.sleep) : undefined },
    { label: "Réveil", value: wake === null ? "non mesuré" : formatClock(wake), note: wake === null ? undefined : `minute ${int(wake)} de la journée` },
    { label: "Commits", value: d.commits === null ? "non mesuré" : int(d.commits), note: e ? centileNote(e.percentiles.commits) : undefined },
  ];
  const w = input.weather;
  if (w) {
    if (w.temp_max !== null) rows.push({ label: "Température max", value: `${dec(w.temp_max, 1)} °C` });
    if (w.precip_mm !== null) rows.push({ label: "Pluie", value: `${dec(w.precip_mm, 1)} mm` });
    if (w.wind_kmh !== null) rows.push({ label: "Vent max", value: `${dec(w.wind_kmh, 0)} km/h` });
  }
  return rows.map((r) => (r.note === undefined ? { label: r.label, value: r.value } : r));
}

function centileNote(p: SelectionExplain["percentiles"]["steps"]): string | undefined {
  if (p.value === null) return undefined;
  const base = `${Math.round(p.value * 100)}ᵉ centile`;
  return p.basis === "percentile" ? `${base} sur ${p.reference_size} j` : `${base} (habitudes par défaut, ${p.reference_size} j de référence)`;
}

function keySection(e: SelectionExplain): FicheModel["key"] {
  const u = `u = partie décimale de (K × ${String(KEY.golden).replace(".", ",")})`;
  if (e.key.mode === "day_index") {
    return {
      formula: "Aucune donnée ce jour-là : K = numéro du jour depuis l'origine",
      substituted: `K = ${int(e.day_index)} (origine : ${longDate(e.origin)})`,
      K: int(e.key.K),
      uFormula: `${u} = partie décimale de ${dec(e.key.K * e.key.golden, 6)}`,
      u: dec(e.key.u, 6),
      note: null,
    };
  }
  const names: Record<string, string> = { steps: "pas × 1000", wake: "minuteDuRéveil × 10", commits: "commits", temp: "round(temp_max × 10) × 100 000 000" };
  const formula = `K = ${e.key.terms.map((t) => names[t.id]).join(" + ")}`;
  const parts = e.key.terms.map((t) => (t.factor === 1 ? int(t.used) : `${int(t.used)} × ${int(t.factor)}`));
  const absent = e.key.terms.filter((t) => t.raw === null).map((t) => ({ steps: "pas", wake: "réveil", commits: "commits", temp: "température" })[t.id]);
  return {
    formula,
    substituted: `K = ${parts.join(" + ")} = ${int(e.key.K)}`,
    K: int(e.key.K),
    uFormula: `${u} = partie décimale de ${dec(e.key.K * e.key.golden, 6)}`,
    u: dec(e.key.u, 6),
    note: absent.length ? `Absent(s) compté(s) 0 dans K seulement : ${absent.join(", ")}.` : null,
  };
}

export function buildFiche(selection: DaySelection, technique: Technique, input: TechniqueInput): FicheModel {
  const e = selection.explain;
  const status = selection.frozen
    ? `Figé le ${selection.frozenAt ? longDate(selection.frozenAt) : "(date inconnue)"} : cette œuvre ne changera plus.`
    : "Calculé sur cette page, pas encore figé : l'API le fige quand la journée a 3 jours.";
  const model: FicheModel = {
    styleName: technique.name,
    familyName: FAMILY_NAMES[technique.family],
    process: technique.process,
    ported: technique.ported,
    status,
    frozen: selection.frozen,
    hasDetail: e !== null,
    raw: rawRows(e, input),
    key: null,
    band: null,
    adjustments: [],
    missingAdjustments: [],
    exclusions: [],
    chances: [],
    draw: null,
    technique: technique.explain(input),
    palette: technique.ownPalette ? null : explainPalette(input.palette, { date: input.date, sleep: input.norms.sleep, tempMax: input.weather?.temp_max ?? null }),
  };
  if (!e) return model;

  model.key = keySection(e);
  const bandLabel = STEP_BANDS.find((b) => b.id === e.band.id)!.label;
  model.band = {
    centile: e.band.percentile === null ? "pas non mesurés → tranche « normale »" : `${Math.round(e.band.percentile * 100)}ᵉ centile des pas`,
    label: bandLabel,
    table: STYLES.map((s) => ({ name: STYLE_NAMES[s], weight: dec(BASE_WEIGHTS[e.band.id][s], 2), highlight: s === e.style }))
      .map((r, i) => ({ ...r, _w: BASE_WEIGHTS[e.band.id][STYLES[i]!] }))
      .sort((a, b) => b._w - a._w)
      .map(({ _w: _, ...r }) => r),
  };
  model.adjustments = e.adjustments.map((a) => ({
    label: a.label,
    reason: adjustmentReason(a),
    effects: a.factors.map((f) => `${STYLE_NAMES[f.style]} ×${dec(f.factor, 2)}`).join(", "),
  }));
  model.missingAdjustments = e.missing_adjustments.map((m) => `${m.label} : ${metricLabel(m.metric)} non disponible, règle non appliquée`);
  model.exclusions = e.exclusions.map((x) => ({ name: STYLE_NAMES[x.style], reason: `${REASON[x.reason] ?? x.reason} (${longDate(x.date)})` }));
  const reasons = new Map(e.exclusions.map((x) => [x.style, REASON[x.reason] ?? x.reason]));
  model.chances = e.candidates.map((c) => ({
    style: c.style,
    name: STYLE_NAMES[c.style],
    family: FAMILY_NAMES[c.family],
    weight: c.excluded ? "exclu" : dec(c.weight, 2),
    chance: c.chance,
    chanceText: c.excluded ? "—" : pct(c.chance),
    excluded: c.excluded,
    reason: reasons.get(c.style) ?? null,
    chosen: c.style === e.style,
  }));
  const chosen = e.candidates.find((c) => c.style === e.style)!;
  model.draw = {
    formula: `point = u × total des poids = ${dec(e.key.u, 6)} × ${dec(e.total, 2)} = ${dec(e.point, 3)}`,
    result: `Le point tombe dans l'intervalle de ${STYLE_NAMES[e.style]} (${dec(chosen.from, 2)} → ${dec(chosen.to, 2)}, poids cumulés dans l'ordre fixe) : ${STYLE_NAMES[e.style]}.`,
  };
  return model;
}

/** Résumé compact (infobulle de la galerie), quelques lignes. */
export function compactFiche(selection: DaySelection, technique: Technique): string {
  const e = selection.explain;
  const lines = [`${technique.name} (${FAMILY_NAMES[technique.family]})${technique.ported ? "" : " · rendu provisoire"}`];
  if (e) {
    const chosen = e.candidates.find((c) => c.style === e.style)!;
    lines.push(`K = ${int(e.key.K)} · u = ${dec(e.key.u, 4)} · chance ${pct(chosen.chance)}`);
    lines.push(`journée ${STEP_BANDS.find((b) => b.id === e.band.id)!.label}${e.adjustments.length ? ` · ${e.adjustments.map((a) => a.label.toLowerCase()).join(", ")}` : ""}`);
    if (e.exclusions.length) lines.push(`exclus : ${e.exclusions.map((x) => STYLE_NAMES[x.style]).join(", ")}`);
  }
  lines.push(selection.frozen ? `figé${selection.frozenAt ? ` le ${longDate(selection.frozenAt)}` : ""}` : "pas encore figé");
  return lines.join("\n");
}
