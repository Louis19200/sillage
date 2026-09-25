/**
 * Calcul de dates pour le contexte (météo, Kp).
 *
 * Règle du projet : une `date` n'est jamais tirée d'un timestamp UTC. Ici :
 *  - les dates des journées viennent de `daily_metrics`, du téléphone ou
 *    d'Open-Meteo (jour local du lieu) ;
 *  - on ne fait que de l'arithmétique de calendrier sur des `YYYY-MM-DD`
 *    (`addDays`), ou le passage **date locale → intervalle UTC** dans un fuseau
 *    nommé (`localDayBounds`, pour agréger le Kp publié en tranches UTC) ;
 *  - la seule date tirée de l'horloge est « aujourd'hui » dans le fuseau local
 *    configuré (`CONTEXT_TZ`, défaut Europe/Paris), jamais en UTC.
 */
const DAY_MS = 86_400_000;

function utcMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Arithmétique de calendrier : `date` + `n` jours. */
export function addDays(date: string, n: number): string {
  return new Date(utcMidnight(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to` (0 si égales). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** Toutes les dates de `from` à `to`, bornes incluses. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Découpe [from, to] en tranches consécutives d'au plus `maxDays` jours. */
export function splitRange(from: string, to: string, maxDays: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let s = from; s <= to; s = addDays(s, maxDays)) {
    const e = addDays(s, maxDays - 1);
    out.push({ from: s, to: e < to ? e : to });
  }
  return out;
}

export function assertTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`fuseau horaire inconnu : ${JSON.stringify(tz)} (ex. Europe/Paris)`);
  }
}

/** « Aujourd'hui » dans le fuseau local `tz` (jamais en UTC). */
export function todayIn(tz: string, now: Date = new Date()): string {
  assertTimeZone(tz);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Décalage (ms) du fuseau `tz` par rapport à UTC à l'instant `t`. */
function offsetMs(tz: string, t: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Instant UTC du début de la journée locale `date` dans `tz` (changements d'heure compris). */
export function localMidnight(date: string, tz: string): number {
  const guess = utcMidnight(date);
  let t = guess - offsetMs(tz, guess);
  t = guess - offsetMs(tz, t); // second passage : corrige un changement d'heure entre les deux
  return t;
}

/** Intervalle UTC [start, end) couvert par la journée locale `date` dans `tz` (23, 24 ou 25 h). */
export function localDayBounds(date: string, tz: string): { start: number; end: number } {
  assertTimeZone(tz);
  return { start: localMidnight(date, tz), end: localMidnight(addDays(date, 1), tz) };
}
