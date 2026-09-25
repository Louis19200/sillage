/** Arithmétique de dates calendaires `YYYY-MM-DD` (UTC utilisé comme simple calculatrice). */
const DAY_MS = 86_400_000;

function toMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`date invalide : ${date}`);
  return ms;
}

export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}
