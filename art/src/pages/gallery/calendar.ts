/**
 * Calendrier pur (sans DOM, sans fuseau) : grilles de mois commençant le lundi.
 * On calcule sur les chaînes `YYYY-MM-DD` avec l'arithmétique UTC comme simple calculatrice,
 * comme `engine/dates.ts` : les dates sont déjà locales.
 */
import { addDays } from "../../engine/dates";

export const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

/** Initiales des jours, lundi en premier. */
export const WEEKDAY_INITIALS_FR = ["L", "M", "M", "J", "V", "S", "D"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `month` de 1 à 12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function mondayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface MonthGrid {
  year: number;
  month: number;
  /** Semaines de 7 cases, lundi → dimanche ; `null` hors du mois. */
  weeks: (string | null)[][];
}

/** Grille d'un mois : 4 à 6 semaines, cases vides avant le 1er et après le dernier jour. */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = isoDate(year, month, 1);
  const lead = mondayIndex(first);
  const count = daysInMonth(year, month);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(isoDate(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month, weeks };
}

/** Toutes les dates d'une année, dans l'ordre. */
export function datesOfYear(year: number): string[] {
  const out: string[] = [];
  for (let d = isoDate(year, 1, 1); d.startsWith(`${year}-`); d = addDays(d, 1)) out.push(d);
  return out;
}

export function datesOfMonth(year: number, month: number): string[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => isoDate(year, month, i + 1));
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

/** `"2026-07"` → `{ year: 2026, month: 7 }`, ou `null` si invalide. */
export function parseMonthKey(s: string | null): { year: number; month: number } | null {
  const m = s ? /^(\d{4})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** « juillet 2026 » */
export function monthTitle(year: number, month: number): string {
  return `${MONTHS_FR[month - 1]} ${year}`;
}
