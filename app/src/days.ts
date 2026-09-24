/**
 * Calcul des journées santé, sans dépendance à React Native ni à Health Connect.
 *
 * Règles (voir docs/API.md et .claude/agents/android-app.md) :
 * - Une journée = de minuit à minuit dans le fuseau du téléphone au moment du calcul.
 *   Les bornes sont construites avec les composants de date locaux (`new Date(a, m, j)`),
 *   jamais en ajoutant 24 h : un jour de changement d'heure dure 23 h ou 25 h.
 * - `date` = ce jour local en `YYYY-MM-DD`. Jamais `toISOString().slice(0, 10)`, qui
 *   donne le jour UTC (faux entre minuit et 2 h à Paris l'été).
 * - On n'envoie jamais aujourd'hui (journée incomplète).
 * - Pas : agrégat Health Connect entre les deux minuits. Aucune source → `null`,
 *   sinon le total, même s'il vaut 0.
 * - Sommeil : sessions dont la FIN tombe dans la journée (la nuit du 23 au 24 compte
 *   pour le 24). Coucher et réveil = ceux de la plus longue session, en ISO 8601 avec
 *   le décalage local. Aucune session → trois `null`.
 *
 * La lecture Health Connect est injectée (`HealthReader`) : tout ce module se teste
 * avec jest, sans téléphone.
 */
import type { HealthDay } from "@sillage/shared";

/** Jour calendaire local, `YYYY-MM-DD`. */
export type LocalDate = string;

/** Journée santé complète : les quatre métriques sont toujours présentes (valeur ou `null`). */
export type ComputedHealthDay = Required<HealthDay>;

/** Intervalle semi-ouvert `[start, end)` couvrant une journée locale. */
export interface DayBounds {
  date: LocalDate;
  start: Date;
  end: Date;
}

/** Ce que renvoie Health Connect pour un agrégat `Steps` (réduit à l'utile). */
export interface StepsAggregate {
  /** `COUNT_TOTAL` : peut valoir 0 même sans aucune donnée, d'où `dataOrigins`. */
  total: number | null | undefined;
  /** Applications ayant fourni des pas sur l'intervalle. Vide = aucune donnée. */
  dataOrigins: readonly string[];
}

/** Une session `SleepSession`, horodatages ISO 8601 tels que Health Connect les donne. */
export interface SleepSession {
  startTime: string;
  endTime: string;
}

/** Accès en lecture à Health Connect. L'implémentation réelle est dans healthConnect.ts. */
export interface HealthReader {
  /** Agrégat des pas sur `[start, end)` (Health Connect dédoublonne téléphone et montre). */
  aggregateSteps(start: Date, end: Date): Promise<StepsAggregate>;
  /** Sessions de sommeil qui recoupent `[start, end)`, toutes pages confondues. */
  readSleepSessions(start: Date, end: Date): Promise<SleepSession[]>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_MINUTE = 60_000;
/** Marge de lecture avant le premier jour : une session finissant ce jour-là a pu commencer la veille. */
const SLEEP_LOOKBACK_MS = 24 * 60 * MS_PER_MINUTE;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Jour local (fuseau du téléphone) de l'instant `d`, en `YYYY-MM-DD`. */
export function localDateOf(d: Date): LocalDate {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(date: LocalDate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Date invalide (YYYY-MM-DD attendu) : ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) {
    throw new Error(`Date inexistante : ${date}`);
  }
  return { y, m, d };
}

/**
 * Bornes locales d'une journée : minuit local inclus → minuit local suivant exclu.
 * `new Date(a, m, j + 1)` laisse le moteur gérer les 23 h / 25 h des changements d'heure
 * (et un minuit sauté par un changement d'heure devient 01:00, le vrai début du jour).
 */
export function dayBounds(date: LocalDate): DayBounds {
  const { y, m, d } = parseLocalDate(date);
  return {
    date,
    start: new Date(y, m - 1, d, 0, 0, 0, 0),
    end: new Date(y, m - 1, d + 1, 0, 0, 0, 0),
  };
}

/**
 * Les `count` dernières journées complètes avant `now`, de la plus ancienne à hier.
 * Aujourd'hui n'est jamais inclus.
 */
export function lastCompleteDays(count: number, now: Date = new Date()): LocalDate[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Nombre de jours invalide : ${count}`);
  }
  const dates: LocalDate[] = [];
  for (let back = count; back >= 1; back--) {
    // Composants locaux : midi aurait aussi marché, mais le jour est normalisé par le moteur.
    dates.push(localDateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)));
  }
  return dates;
}

/** Instant en ISO 8601 avec le décalage local de ce moment-là : `2026-09-23T06:40:00+02:00`. */
export function toLocalOffsetIso(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new Error("Date invalide");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${localDateOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Pas de la journée : `null` si aucune source n'a fourni de données, sinon le total (0 compris). */
export function stepsFromAggregate(agg: StepsAggregate): number | null {
  if (agg.dataOrigins.length === 0) return null;
  if (typeof agg.total !== "number" || !Number.isFinite(agg.total)) return null;
  return Math.round(agg.total);
}

interface Interval {
  start: number;
  end: number;
}

function toInterval(s: SleepSession): Interval | null {
  const start = Date.parse(s.startTime);
  const end = Date.parse(s.endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return { start, end };
}

/** Durée couverte par l'union des intervalles (deux sessions qui se recouvrent ne comptent qu'une fois). */
function unionDurationMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let cur: Interval | null = null;
  for (const iv of sorted) {
    if (cur && iv.start <= cur.end) {
      cur.end = Math.max(cur.end, iv.end);
    } else {
      if (cur) total += cur.end - cur.start;
      cur = { ...iv };
    }
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

export type SleepFields = Pick<
  ComputedHealthDay,
  "sleep_minutes" | "sleep_start" | "sleep_end"
>;

/**
 * Sommeil d'une journée : sessions dont la fin tombe dans `[bounds.start, bounds.end)`.
 * - `sleep_minutes` : somme des durées (sieste + nuit). Si deux sources enregistrent la
 *   même nuit (téléphone et montre), les recouvrements ne sont comptés qu'une fois.
 * - `sleep_start` / `sleep_end` : la plus longue session.
 */
export function sleepForDay(sessions: readonly SleepSession[], bounds: DayBounds): SleepFields {
  const from = bounds.start.getTime();
  const to = bounds.end.getTime();
  const intervals = sessions
    .map(toInterval)
    .filter((iv): iv is Interval => iv !== null && iv.end >= from && iv.end < to);

  const [first, ...rest] = intervals;
  if (!first) return { sleep_minutes: null, sleep_start: null, sleep_end: null };

  let longest = first;
  for (const iv of rest) {
    if (iv.end - iv.start > longest.end - longest.start) longest = iv;
  }
  return {
    sleep_minutes: Math.round(unionDurationMs(intervals) / MS_PER_MINUTE),
    sleep_start: toLocalOffsetIso(new Date(longest.start)),
    sleep_end: toLocalOffsetIso(new Date(longest.end)),
  };
}

/**
 * Calcule les journées demandées. Une lecture de sommeil couvre toute la période
 * (plus 24 h avant), puis chaque session est rattachée au jour de sa fin.
 * Les pas sont agrégés jour par jour, séquentiellement (Health Connect limite le débit).
 */
export async function computeHealthDays(
  reader: HealthReader,
  dates: readonly LocalDate[]
): Promise<ComputedHealthDay[]> {
  if (dates.length === 0) return [];
  const bounds = dates.map(dayBounds);
  const earliest = Math.min(...bounds.map((b) => b.start.getTime()));
  const latest = Math.max(...bounds.map((b) => b.end.getTime()));

  const sessions = await reader.readSleepSessions(
    new Date(earliest - SLEEP_LOOKBACK_MS),
    new Date(latest)
  );

  const days: ComputedHealthDay[] = [];
  for (const b of bounds) {
    const steps = stepsFromAggregate(await reader.aggregateSteps(b.start, b.end));
    days.push({ date: b.date, steps, ...sleepForDay(sessions, b) });
  }
  return days;
}

/** Les `count` dernières journées complètes (hier compris, aujourd'hui exclu), de la plus ancienne à hier. */
export function computeLastCompleteDays(
  reader: HealthReader,
  count: number,
  now: Date = new Date()
): Promise<ComputedHealthDay[]> {
  return computeHealthDays(reader, lastCompleteDays(count, now));
}
