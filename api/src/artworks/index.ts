/**
 * Moteur v2 : gel des styles (table `artworks`, migration 003).
 *
 * - `freezeStyles` calcule la chaîne de sélection (`@sillage/shared`, la même que le navigateur)
 *   sur tout l'historique et fige chaque jour qui a au moins `FREEZE_MIN_AGE_DAYS` jours et
 *   n'est pas encore figé. Idempotente : une ligne n'est jamais réécrite (ON CONFLICT DO NOTHING).
 * - `attachStyles` ajoute `style` et `style_explain` aux journées figées renvoyées par
 *   `GET /day/:date` et `GET /range` (ajout additif au contrat, voir docs/API.md).
 *
 * Un jour figé ne change plus jamais, même si ses données ou la règle de sélection changent :
 * c'est ce qui garantit qu'une œuvre passée reste la même.
 */
import {
  addDays,
  computeChain,
  isStyleId,
  SELECTION_VERSION,
  type DailyMetrics,
  type DayContext,
  type SelectionDay,
  type StyleExplain,
  type StyleId,
} from "@sillage/shared";
import { getContexts } from "../context/store";
import { getDb, type Db, type SqlExecutor } from "../db";

/** Version du moteur de rendu inscrite avec chaque style figé. */
export const ENGINE_VERSION = "v2";
/** Un jour est figé quand il a au moins 3 jours (aujourd'hui − date ≥ 3). */
export const FREEZE_MIN_AGE_DAYS = 3;
/** Fuseau qui définit « aujourd'hui » pour la tâche (jamais utilisé pour dater une donnée). */
export const FREEZE_TIME_ZONE = "Europe/Paris";
const INSERT_BATCH = 200;

export interface FrozenArtwork {
  date: string;
  engine_version: string;
  style: StyleId;
  selection_version: number;
  explain: Record<string, unknown>;
  frozen_at: string;
}

/** Date du jour dans `timeZone`, au format YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Ce que la sélection lit d'une journée. La météo vient de `daily_context` (phase 8) quand
 * elle existe ; sinon d'éventuels champs à plat, sinon rien.
 */
export function toSelectionDay(d: DailyMetrics, context?: DayContext | null): SelectionDay {
  const extra = d as unknown as Record<string, unknown>;
  const opt = (k: string): number | null | undefined => (typeof extra[k] === "number" ? (extra[k] as number) : extra[k] === null ? null : undefined);
  return {
    date: d.date,
    steps: d.steps,
    sleep_minutes: d.sleep_minutes,
    sleep_end: d.sleep_end,
    commits: d.commits,
    temp_max: context?.temp_max ?? opt("temp_max"),
    precip_mm: context?.precip_mm ?? opt("precip_mm"),
    wind_max_kmh: context?.wind_max_kmh ?? opt("wind_max_kmh"),
  };
}

function toIso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  return d.toISOString();
}

function rowToArtwork(r: Record<string, unknown>): FrozenArtwork | null {
  if (!isStyleId(r.style)) return null;
  const explain = typeof r.explain === "string" ? (JSON.parse(r.explain) as Record<string, unknown>) : (r.explain as Record<string, unknown>);
  return {
    date: String(r.date),
    engine_version: String(r.engine_version),
    style: r.style,
    selection_version: Number(r.selection_version),
    explain: explain ?? {},
    frozen_at: toIso(r.frozen_at),
  };
}

const SELECT_ARTWORK = `SELECT to_char(date, 'YYYY-MM-DD') AS date, engine_version, style, selection_version, explain, frozen_at FROM artworks`;

/** Styles figés entre deux dates incluses. */
export async function getFrozen(executor: SqlExecutor, from: string, to: string): Promise<Map<string, FrozenArtwork>> {
  const rows = await executor.query(`${SELECT_ARTWORK} WHERE date >= $1 AND date <= $2 ORDER BY date`, [from, to]);
  const out = new Map<string, FrozenArtwork>();
  for (const r of rows) {
    const a = rowToArtwork(r);
    if (a) out.set(a.date, a);
  }
  return out;
}

/** `style_explain` tel que le renvoie l'API : l'explication du calcul + la date du gel. */
export function styleExplainOf(a: FrozenArtwork): StyleExplain {
  return { ...a.explain, selection_version: a.selection_version, style: a.style, frozen_at: a.frozen_at, engine_version: a.engine_version };
}

/** Ajoute `style` et `style_explain` aux journées figées (les autres sont renvoyées telles quelles). */
export async function attachStyles(executor: SqlExecutor, days: DailyMetrics[]): Promise<DailyMetrics[]> {
  if (days.length === 0) return days;
  const dates = days.map((d) => d.date).sort();
  const frozen = await getFrozen(executor, dates[0]!, dates[dates.length - 1]!);
  return days.map((d) => {
    const a = frozen.get(d.date);
    return a ? { ...d, style: a.style, style_explain: styleExplainOf(a) } : d;
  });
}

export interface FreezeReport {
  today: string;
  /** Dernier jour figeable (today − 3). */
  cutoff: string;
  origin: string | null;
  selection_version: number;
  /** Jours figés par ce passage. */
  frozen: number;
  first: string | null;
  last: string | null;
  /** Jours de [origin, cutoff] déjà figés avant ce passage. */
  already_frozen: number;
}

export interface FreezeOptions {
  db?: Db;
  /** « Aujourd'hui » (YYYY-MM-DD), pour les tests ; défaut : la date à Paris. */
  today?: string;
}

/**
 * Fige les styles de tous les jours de l'origine (premier jour de `daily_metrics`) à
 * aujourd'hui − 3, y compris les jours sans données (ils reçoivent quand même un style).
 * Un passage relancé ne fige rien de plus : aucun jour n'est recalculé une fois figé.
 */
export async function freezeStyles(options: FreezeOptions = {}): Promise<FreezeReport> {
  const db = options.db ?? getDb();
  const today = options.today ?? todayIn(FREEZE_TIME_ZONE);
  const cutoff = addDays(today, -FREEZE_MIN_AGE_DAYS);
  const report: FreezeReport = { today, cutoff, origin: null, selection_version: SELECTION_VERSION, frozen: 0, first: null, last: null, already_frozen: 0 };

  const [bounds] = await db.executor.query<{ first: string | null }>(`SELECT to_char(min(date), 'YYYY-MM-DD') AS first FROM daily_metrics`);
  const origin = bounds?.first ?? null;
  if (!origin || origin > cutoff) return { ...report, origin };
  report.origin = origin;

  // Toute l'histoire jusqu'à aujourd'hui (les 90 jours de référence d'un jour ne regardent qu'en arrière).
  const contexts = await getContexts(db.executor, origin, today);
  const days = (await db.getRange(origin, today)).map((d) => toSelectionDay(d, contexts.get(d.date)));
  const existing = await getFrozen(db.executor, origin, cutoff);
  report.already_frozen = existing.size;
  const frozen = new Map<string, StyleId>([...existing].map(([date, a]) => [date, a.style]));

  const chain = computeChain({ days, origin, to: cutoff, frozen });
  const fresh = chain.entries.filter((e) => !e.frozen && e.explain);
  for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
    const batch = fresh.slice(i, i + INSERT_BATCH);
    const params: unknown[] = [];
    const values = batch.map((e) => {
      params.push(e.date, ENGINE_VERSION, e.style, SELECTION_VERSION, JSON.stringify(e.explain));
      const n = params.length;
      return `($${n - 4}::date, $${n - 3}, $${n - 2}, $${n - 1}, $${n}::jsonb)`;
    });
    await db.executor.query(
      `INSERT INTO artworks (date, engine_version, style, selection_version, explain) VALUES ${values.join(", ")} ON CONFLICT (date) DO NOTHING`,
      params,
    );
  }
  report.frozen = fresh.length;
  report.first = fresh[0]?.date ?? null;
  report.last = fresh.at(-1)?.date ?? null;
  return report;
}

/** Tâche `freeze-styles` (jobs.ts, Vercel Cron `/cron/freeze-styles`). */
/**
 * Tâche planifiée. Le gel est irréversible : il ne démarre que si `FREEZE_STYLES=true`, à
 * poser APRÈS le backfill météo (`context:backfill`), pour que le nombre clé de tout
 * l'historique inclue la température. Sans la variable, la tâche ne fait rien et le dit.
 */
export async function runFreezeStylesJob(): Promise<FreezeReport | { skipped: string }> {
  if (process.env.FREEZE_STYLES !== "true") {
    return { skipped: "FREEZE_STYLES n'est pas à true : aucun style figé (à activer après le backfill météo)" };
  }
  return freezeStyles();
}
