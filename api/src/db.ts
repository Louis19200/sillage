/**
 * Accès à la base. Module partagé par l'API, les collecteurs et l'ops.
 *
 * Deux façons de l'utiliser :
 *  - fonctions de haut niveau (`upsertCommits(rows)`, `logIngest(...)`…) qui
 *    passent par la base par défaut (Postgres via `DATABASE_URL`) ;
 *  - `createDb(executor)` pour obtenir les mêmes fonctions sur une autre base
 *    (PGlite dans les tests : `createDb(pgliteExecutor(new PGlite()))`).
 *
 * Règles (docs/API.md) : `date` reste une chaîne `YYYY-MM-DD` de bout en bout,
 * `null` ≠ `0`, upsert sur `date`, chaque source n'écrit que ses colonnes.
 */
import postgres from "postgres";
import { DailyMetrics, HealthDay, IsoDate } from "@sillage/shared";
import { loadDatabaseConfig } from "./env";

// ---------------------------------------------------------------------------
// Exécuteur SQL minimal (Postgres en prod, PGlite en test)
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export interface SqlExecutor {
  /** Requête paramétrée ($1, $2…). Une seule instruction. */
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Script SQL sans paramètre, éventuellement multi-instructions (migrations). */
  exec(text: string): Promise<void>;
  /** Exécute `fn` dans une transaction (imbriquée : réutilise la courante). */
  transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/** OID Postgres du type `date`. */
const DATE_OID = 1082;

/**
 * Options du client en mode serverless (`DATABASE_SERVERLESS=true`, Vercel + Neon) :
 * une seule connexion par instance, pas de requêtes préparées nommées (le pooler
 * Neon / pgbouncer en mode transaction ne les suit pas d'une connexion à l'autre),
 * connexions inactives fermées vite pour ne pas saturer le pooler.
 * Durées en secondes.
 */
export const SERVERLESS_POSTGRES_OPTIONS = {
  max: 1,
  prepare: false,
  idle_timeout: 5,
  connect_timeout: 10,
  max_lifetime: 60 * 5,
} as const satisfies postgres.Options<{}>;

/** Options du client selon le mode : `{}` (comportement par défaut) ou serverless. */
export function postgresClientOptions(serverless: boolean): postgres.Options<{}> {
  return serverless ? { ...SERVERLESS_POSTGRES_OPTIONS } : {};
}

/**
 * Client `postgres` configuré pour que le type `date` reste une chaîne
 * `YYYY-MM-DD` (sinon conversion en `Date` JS et décalage de fuseau).
 */
export function createPostgresClient(url: string, options: postgres.Options<{}> = {}) {
  return postgres(url, {
    max: 5,
    onnotice: () => {},
    ...options,
    types: {
      ...(options.types ?? {}),
      date: {
        to: DATE_OID,
        from: [DATE_OID],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  });
}

type AnySql = postgres.Sql<any> | postgres.TransactionSql<any>;

export function postgresExecutor(sql: AnySql, inTransaction = false): SqlExecutor {
  const self: SqlExecutor = {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return [...rows] as unknown as T[];
    },
    async exec(text) {
      await sql.unsafe(text).simple();
    },
    async transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
      if (inTransaction || !("begin" in sql)) return fn(self);
      const result = await (sql as postgres.Sql<any>).begin((tx) => fn(postgresExecutor(tx, true)));
      return result as R;
    },
    async close() {
      if (!inTransaction && "end" in sql) await (sql as postgres.Sql<any>).end({ timeout: 5 });
    },
  };
  return self;
}

/** Forme structurelle de PGlite (évite d'importer PGlite hors des tests). */
export interface PgliteQueryable {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
}
export interface PgliteLike extends PgliteQueryable {
  transaction<R>(fn: (tx: PgliteQueryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

export function pgliteExecutor(pg: PgliteLike | PgliteQueryable, inTransaction = false): SqlExecutor {
  const self: SqlExecutor = {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
    async exec(text) {
      await pg.exec(text);
    },
    async transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
      if (inTransaction || !("transaction" in pg)) return fn(self);
      return pg.transaction((tx) => fn(pgliteExecutor(tx, true)));
    },
    async close() {
      if (!inTransaction && "close" in pg) await pg.close();
    },
  };
  return self;
}

// ---------------------------------------------------------------------------
// Fonctions métier
// ---------------------------------------------------------------------------

export type CommitRow = { date: string; commits: number };

export type IngestLogEntry = {
  source: string;
  days_count: number;
  first_date: string | null;
  last_date: string | null;
  ok: boolean;
  error: string | null;
};

export interface Db {
  readonly executor: SqlExecutor;
  /** N'écrit que les champs présents : omis = intact, `null` = effacé. Retourne le nombre de jours traités. */
  upsertHealthDays(days: HealthDay[]): Promise<number>;
  /** N'écrit que `commits`. Retourne le nombre de jours traités. */
  upsertCommits(rows: CommitRow[]): Promise<number>;
  getDay(date: string): Promise<DailyMetrics | null>;
  /** Bornes incluses, triées par date. Seuls les jours présents en base. */
  getRange(from: string, to: string): Promise<DailyMetrics[]>;
  logIngest(entry: IngestLogEntry): Promise<void>;
  close(): Promise<void>;
}

/**
 * Colonnes que `/ingest/health` a le droit d'écrire. Les noms de colonnes
 * insérés dans le SQL viennent **uniquement** de cette liste ; les valeurs
 * passent toujours en paramètres.
 */
export const HEALTH_COLUMNS = ["steps", "sleep_minutes", "sleep_start", "sleep_end"] as const;
type HealthColumn = (typeof HEALTH_COLUMNS)[number];

const SELECT_DAY = `
  SELECT to_char(date, 'YYYY-MM-DD') AS date,
         steps, sleep_minutes, sleep_start, sleep_end, commits, updated_at
  FROM daily_metrics`;

function toIsoTimestamp(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  // Timestamps uniquement : jamais utilisé pour calculer une `date`.
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`timestamp illisible : ${String(v)}`);
  return d.toISOString();
}

function toCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

function rowToDailyMetrics(r: Row): DailyMetrics {
  return {
    date: String(r.date),
    steps: toCount(r.steps),
    sleep_minutes: toCount(r.sleep_minutes),
    sleep_start: toIsoTimestamp(r.sleep_start),
    sleep_end: toIsoTimestamp(r.sleep_end),
    commits: toCount(r.commits),
    updated_at: toIsoTimestamp(r.updated_at) as string,
  };
}

function assertIsoDate(value: string, what: string): void {
  if (!IsoDate.safeParse(value).success) throw new Error(`${what} invalide : ${JSON.stringify(value)} (attendu YYYY-MM-DD)`);
}

/** Construit l'UPSERT d'une journée sur les seules colonnes présentes. */
export function buildHealthUpsert(day: HealthDay): { text: string; params: unknown[] } {
  const cols: HealthColumn[] = HEALTH_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(day, c) && day[c] !== undefined);
  const params: unknown[] = [day.date, ...cols.map((c) => day[c] ?? null)];
  const insertCols = ["date", ...cols, "updated_at"].join(", ");
  const values = ["$1", ...cols.map((_, i) => `$${i + 2}`), "now()"].join(", ");
  const updates = [...cols.map((c) => `${c} = EXCLUDED.${c}`), "updated_at = now()"].join(", ");
  return {
    text: `INSERT INTO daily_metrics (${insertCols}) VALUES (${values}) ON CONFLICT (date) DO UPDATE SET ${updates}`,
    params,
  };
}

/**
 * Upsert de plusieurs journées en une requête par jeu de colonnes (au lieu d'une par
 * journée) : un backfill de 365 jours ne fait plus que 1 à 4 allers-retours vers la base.
 * Une même date présente plusieurs fois est fusionnée (les champs les plus récents
 * l'emportent), comme l'auraient fait des upserts successifs ; Postgres refuse sinon
 * qu'un même INSERT … ON CONFLICT touche deux fois la même ligne.
 */
export function buildHealthUpsertBatch(days: readonly HealthDay[]): { text: string; params: unknown[] }[] {
  const merged = new Map<string, HealthDay>();
  for (const d of days) merged.set(d.date, { ...merged.get(d.date), ...d });

  const groups = new Map<string, { cols: HealthColumn[]; days: HealthDay[] }>();
  for (const d of merged.values()) {
    const cols: HealthColumn[] = HEALTH_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(d, c) && d[c] !== undefined);
    const key = cols.join(",");
    const g = groups.get(key) ?? { cols, days: [] };
    g.days.push(d);
    groups.set(key, g);
  }

  return [...groups.values()].map(({ cols, days: group }) => {
    const params: unknown[] = [];
    const rows = group.map((d) => {
      const placeholders = [d.date, ...cols.map((c) => d[c] ?? null)].map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${[...placeholders, "now()"].join(", ")})`;
    });
    const insertCols = ["date", ...cols, "updated_at"].join(", ");
    const updates = [...cols.map((c) => `${c} = EXCLUDED.${c}`), "updated_at = now()"].join(", ");
    return {
      text: `INSERT INTO daily_metrics (${insertCols}) VALUES ${rows.join(", ")} ON CONFLICT (date) DO UPDATE SET ${updates}`,
      params,
    };
  });
}

export function createDb(executor: SqlExecutor): Db {
  return {
    executor,

    async upsertHealthDays(days) {
      for (const d of days) {
        const parsed = HealthDay.strict().safeParse(d);
        if (!parsed.success) throw new Error(`journée santé invalide (${d?.date}) : ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      await executor.transaction(async (tx) => {
        for (const { text, params } of buildHealthUpsertBatch(days)) {
          await tx.query(text, params);
        }
      });
      return days.length;
    },

    async upsertCommits(rows) {
      for (const r of rows) {
        assertIsoDate(r.date, "date");
        if (!Number.isInteger(r.commits) || r.commits < 0) {
          throw new Error(`commits invalide pour ${r.date} : ${String(r.commits)} (entier >= 0 attendu)`);
        }
      }
      await executor.transaction(async (tx) => {
        for (const r of rows) {
          await tx.query(
            `INSERT INTO daily_metrics (date, commits, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (date) DO UPDATE SET commits = EXCLUDED.commits, updated_at = now()`,
            [r.date, r.commits],
          );
        }
      });
      return rows.length;
    },

    async getDay(date) {
      assertIsoDate(date, "date");
      const rows = await executor.query(`${SELECT_DAY} WHERE date = $1`, [date]);
      return rows[0] ? rowToDailyMetrics(rows[0]) : null;
    },

    async getRange(from, to) {
      assertIsoDate(from, "from");
      assertIsoDate(to, "to");
      const rows = await executor.query(`${SELECT_DAY} WHERE date BETWEEN $1 AND $2 ORDER BY date`, [from, to]);
      return rows.map(rowToDailyMetrics);
    },

    async logIngest(e) {
      await executor.query(
        `INSERT INTO ingest_log (source, days_count, first_date, last_date, ok, error)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.source, e.days_count, e.first_date, e.last_date, e.ok, e.error],
      );
    },

    close: () => executor.close(),
  };
}

// ---------------------------------------------------------------------------
// Base par défaut (Postgres via DATABASE_URL), créée à la première utilisation
// ---------------------------------------------------------------------------

let defaultDb: Db | undefined;

export function getDb(): Db {
  if (!defaultDb) {
    const { url, serverless } = loadDatabaseConfig();
    defaultDb = createDb(postgresExecutor(createPostgresClient(url, postgresClientOptions(serverless))));
  }
  return defaultDb;
}

/** Remplace la base par défaut (tests, scripts). `undefined` la réinitialise. */
export function setDb(db: Db | undefined): void {
  defaultDb = db;
}

export async function closeDb(): Promise<void> {
  const db = defaultDb;
  defaultDb = undefined;
  await db?.close();
}

export const upsertHealthDays = (days: HealthDay[]): Promise<number> => getDb().upsertHealthDays(days);
export const upsertCommits = (rows: CommitRow[]): Promise<number> => getDb().upsertCommits(rows);
export const getDay = (date: string): Promise<DailyMetrics | null> => getDb().getDay(date);
export const getRange = (from: string, to: string): Promise<DailyMetrics[]> => getDb().getRange(from, to);
export const logIngest = (entry: IngestLogEntry): Promise<void> => getDb().logIngest(entry);
