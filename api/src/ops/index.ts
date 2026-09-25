/**
 * Zone ops-reliability, montée par une seule ligne au début de `createApp` (app.ts) :
 *
 *  - `GET /health` : public (aucun token, même avec PROTECT_READS), sans donnée
 *    personnelle ; `200` avec l'état de la base et la dernière ingestion réussie
 *    par source, `503` si la base ne répond pas. Contrat : docs/API.md.
 *  - journaux structurés (une ligne JSON) de chaque ingestion (`/ingest/*`) et de
 *    chaque tâche (`/cron/*`) : source, nombre de jours, durée, succès ou erreur.
 *    Jamais de token ni de corps de requête.
 *
 * Les middlewares ne sont montés que sur `/ingest/*` et `/cron/*` (jamais sur `*`)
 * et doivent être enregistrés **avant** ces routes : Hono exécute les middlewares
 * dans l'ordre d'enregistrement.
 */
import type { Context, Hono } from "hono";
import type { AppDeps } from "../app";
import type { Db } from "../db";
import { MONITORED_SOURCES, lastSuccessfulIngests } from "./freshness";
import { logEvent, type EventLogger } from "./log";
import { warnIfNoNotifier } from "./notifier";

/** Tâches planifiées qui ingèrent une source (pour le journal d'ingestion). */
export const JOB_SOURCES: Record<string, string> = { "github-sync": "github" };

/** Délai au-delà duquel la base est considérée injoignable (réveil de Neon compris). */
export const HEALTH_DB_TIMEOUT_MS = 8_000;

export type HealthResponse = {
  status: "ok" | "error";
  db: "ok" | "error";
  last_ingest: Record<string, string | null>;
};

export type OpsOptions = { log?: EventLogger; dbTimeoutMs?: number; env?: NodeJS.ProcessEnv };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`base sans réponse après ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function healthStatus(db: Db, timeoutMs = HEALTH_DB_TIMEOUT_MS): Promise<{ code: 200 | 503; body: HealthResponse; error?: string }> {
  try {
    const lasts = await withTimeout(
      (async () => {
        await db.executor.query("SELECT 1");
        return lastSuccessfulIngests(db, MONITORED_SOURCES);
      })(),
      timeoutMs,
    );
    const last_ingest = Object.fromEntries(Object.entries(lasts).map(([k, v]) => [k, v?.toISOString() ?? null]));
    return { code: 200, body: { status: "ok", db: "ok", last_ingest } };
  } catch (err) {
    const last_ingest = Object.fromEntries(MONITORED_SOURCES.map((s) => [s, null]));
    return { code: 503, body: { status: "error", db: "error", last_ingest }, error: err instanceof Error ? err.message : String(err) };
  }
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.res.clone().json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function mountOps(app: Hono, deps: AppDeps, opts: OpsOptions = {}): void {
  const log = opts.log ?? logEvent;
  warnIfNoNotifier(opts.env ?? process.env, log);

  // --- Journal des ingestions envoyées par le téléphone -----------------------
  app.use("/ingest/*", async (c, next) => {
    const started = performance.now();
    await next();
    const status = c.res.status;
    // Comme ingest_log : les appels non authentifiés ne sont pas des ingestions.
    if (status === 401 || status === 404) return;
    const body = await jsonBody(c);
    const ok = status === 200;
    log(ok ? "info" : "error", "ingest", {
      source: c.req.path.split("/")[2] ?? "inconnue",
      days: ok ? num(body?.upserted) : null,
      duration_ms: Math.round(performance.now() - started),
      ok,
      http_status: status,
      // Message court de l'API (jamais le corps de la requête ni le détail zod).
      error: ok ? undefined : (str(body?.message) ?? str(body?.error) ?? `HTTP ${status}`),
    });
  });

  // --- Journal des tâches planifiées (et des ingestions qu'elles font) --------
  app.use("/cron/*", async (c, next) => {
    await next();
    const status = c.res.status;
    if (status !== 200 && status !== 500) return; // 401, 404, 503 : la tâche n'a pas tourné
    const body = await jsonBody(c);
    const job = str(body?.job) ?? c.req.path.split("/")[2] ?? "inconnue";
    const ok = body?.ok === true;
    const duration_ms = num(body?.duration_ms);
    const error = ok ? undefined : (str(body?.error) ?? `HTTP ${status}`);
    log(ok ? "info" : "error", "job", { job, ok, duration_ms, error });

    const result = body?.result && typeof body.result === "object" ? (body.result as Record<string, unknown>) : null;
    const source = str(result?.source) ?? JOB_SOURCES[job];
    if (source) {
      log(ok ? "info" : "error", "ingest", { source, days: ok ? num(result?.days_written) : null, duration_ms, ok, job, error });
    }
  });

  // --- GET /health (public) ----------------------------------------------------
  app.get("/health", async (c) => {
    const { code, body, error } = await healthStatus(deps.db, opts.dbTimeoutMs);
    if (error) log("error", "health", { db: "error", error });
    c.header("Cache-Control", "no-store");
    return c.json(body, code);
  });
}
