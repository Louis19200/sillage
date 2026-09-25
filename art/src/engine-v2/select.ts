/**
 * Style de chaque jour côté navigateur : le style figé renvoyé par l'API quand il existe,
 * sinon le calcul de `computeChain` (@sillage/shared), le même que celui de l'API.
 */
import { computeChain, isStyleId, type SelectionExplain, type SelectionDay, type StyleId } from "@sillage/shared";
import type { DayV2 } from "./input";

/** Une journée telle que la renvoie la source de données (avec le style figé éventuel). */
export type DayWithStyle = DayV2 & {
  style?: string | undefined;
  style_explain?: Record<string, unknown> | undefined;
};

export interface DaySelection {
  date: string;
  style: StyleId;
  /** Figé par l'API : ne changera plus. */
  frozen: boolean;
  frozenAt: string | null;
  /** Détail du calcul (celui du jour du gel pour un jour figé ; `null` si l'API n'en a pas gardé). */
  explain: SelectionExplain | null;
}

function isExplain(x: unknown): x is SelectionExplain {
  return typeof x === "object" && x !== null && Array.isArray((x as SelectionExplain).candidates) && typeof (x as SelectionExplain).key === "object";
}

export function toSelectionDay(d: DayV2): SelectionDay {
  return {
    date: d.date,
    steps: d.steps,
    sleep_minutes: d.sleep_minutes,
    sleep_end: d.sleep_end,
    commits: d.commits,
    temp_max: d.context?.temp_max ?? d.temp_max,
    precip_mm: d.context?.precip_mm ?? d.precip_mm,
    wind_max_kmh: d.context?.wind_max_kmh ?? d.wind_max_kmh,
  };
}

/**
 * Origine de la chaîne : celle qu'a utilisée l'API (lue dans un `style_explain`), sinon
 * `VITE_SELECTION_ORIGIN`, sinon le premier jour fourni (fixtures : tout l'historique est là).
 */
export function resolveOrigin(days: readonly DayWithStyle[], configured?: string | undefined): string | undefined {
  for (const d of days) {
    const o = d.style_explain?.origin;
    if (typeof o === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  }
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
  return days.map((d) => d.date).sort()[0];
}

/** Styles de `from` à `to` (inclus). `days` doit couvrir les 90 jours avant `from` pour les centiles. */
export function selectStyles(
  days: readonly DayWithStyle[],
  from: string,
  to: string,
  options: { origin?: string | undefined } = {},
): Map<string, DaySelection> {
  const frozen = new Map<string, StyleId>();
  const frozenInfo = new Map<string, { at: string | null; explain: SelectionExplain | null }>();
  for (const d of days) {
    if (!isStyleId(d.style)) continue;
    frozen.set(d.date, d.style);
    const at = typeof d.style_explain?.frozen_at === "string" ? d.style_explain.frozen_at : null;
    frozenInfo.set(d.date, { at, explain: isExplain(d.style_explain) ? d.style_explain : null });
  }
  let origin = resolveOrigin(days, options.origin) ?? from;
  // Avant l'origine il n'y a aucune donnée : ces jours n'ont pas de style… sauf si l'on ne demande
  // que des jours d'avant (page d'une date très ancienne) : la chaîne part alors de `from`.
  if (to < origin) origin = from;
  const start = from < origin ? origin : from;
  const chain = computeChain({ days: days.map(toSelectionDay), from: start, to, origin, frozen });
  const out = new Map<string, DaySelection>();
  for (const e of chain.entries) {
    const info = frozenInfo.get(e.date);
    out.set(e.date, {
      date: e.date,
      style: e.style,
      frozen: e.frozen,
      frozenAt: info?.at ?? null,
      explain: e.frozen ? (info?.explain ?? null) : e.explain,
    });
  }
  return out;
}
