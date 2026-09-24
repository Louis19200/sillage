/** Mise en forme de la légende (valeurs brutes). `null` s'affiche « non mesuré », jamais 0. */
import type { DayInput } from "../../engine/day";
import type { MetricNorm } from "../../engine/normalize";

const nf = new Intl.NumberFormat("fr-FR");

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « mercredi 23 septembre 2026 », calculé sur la chaîne, sans fuseau. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d === 1 ? "1er" : d} ${MONTHS[m - 1]} ${y}`;
}

export function formatSteps(steps: number | null): string | null {
  return steps === null ? null : nf.format(steps);
}

export function formatSleep(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Heure locale « 07:57 » lue directement dans la chaîne ISO (avec décalage). */
export function clockOf(iso: string | null): string | null {
  const m = iso === null ? null : /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1]! : null;
}

export function formatCommits(commits: number | null): string | null {
  return commits === null ? null : nf.format(commits);
}

/** « 62e centile » ou « défaut » : discret, pour comprendre la normalisation. */
export function formatNorm(norm: MetricNorm): string {
  if (norm.value === null) return "";
  const pct = Math.round(norm.value * 100);
  return norm.basis === "percentile" ? `${pct}ᵉ centile` : `${pct} % (habitudes par défaut)`;
}

export interface LegendRow {
  label: string;
  value: string | null;
  detail: string;
}

export function legendRows(
  day: DayInput,
  norms: Record<"steps" | "sleep_minutes" | "commits", MetricNorm>,
): LegendRow[] {
  const bed = clockOf(day.sleep_start);
  const wake = clockOf(day.sleep_end);
  const sleepWindow = bed && wake ? `${bed} → ${wake}` : "";
  return [
    { label: "Sommeil", value: formatSleep(day.sleep_minutes), detail: [sleepWindow, formatNorm(norms.sleep_minutes)].filter(Boolean).join(" · ") },
    { label: "Pas", value: formatSteps(day.steps), detail: formatNorm(norms.steps) },
    { label: "Commits", value: formatCommits(day.commits), detail: formatNorm(norms.commits) },
  ];
}
