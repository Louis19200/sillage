/**
 * Arithmétique de dates calendaires `YYYY-MM-DD`. On passe par UTC uniquement
 * comme calculatrice de calendrier : la date elle-même est déjà locale (voir CLAUDE.md).
 */

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`date invalide : ${date}`);
  return ms;
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** Nombre de jours de `a` à `b` (positif si b est après a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ms) && fromUtcMs(ms) === s;
}
