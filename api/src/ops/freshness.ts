/**
 * Contrôle de fraîcheur des données (tâche `check-freshness`, jobs.ts).
 *
 * Pour chaque source, compare la dernière ingestion **réussie** (`ingest_log.ok`)
 * au seuil de la source. Au passage « à jour → en retard », une alerte ; au
 * passage inverse, un message « rétabli » ; sinon rien. L'état vit dans la table
 * `alert_state` (migration 002) : il survit aux redémarrages et aux instances
 * serverless, et une double exécution du cron n'envoie pas deux alertes.
 *
 * Si l'envoi échoue, l'état n'est pas changé : le contrôle suivant réessaie.
 */
import { getDb, type Db } from "../db";
import { logEvent, type EventLogger } from "./log";
import { notifierFromEnv, type Alert, type Notifier } from "./notifier";

export type FreshnessRule = {
  source: string;
  thresholdHours: number;
  /** Nom lisible dans les notifications. */
  label: string;
  /** Que faire quand la source est en retard. */
  hint: string;
};

/**
 * Seuils. Le contrôle tourne une fois par jour sur Vercel (plan Hobby) : l'alerte
 * part au **premier contrôle** après le seuil, soit entre 48 h et 72 h sans
 * données santé, et après trois nuits sans synchro GitHub réussie.
 */
export const FRESHNESS_RULES: readonly FreshnessRule[] = [
  {
    source: "health",
    thresholdHours: 48,
    label: "santé",
    hint: "Ouvre l'app Sillage sur le téléphone et appuie sur « Synchroniser (7 jours) » ; vérifie les autorisations Health Connect.",
  },
  {
    source: "github",
    thresholdHours: 72,
    label: "GitHub",
    hint: "Regarde le cron github-sync dans Vercel (Logs) et la validité de GITHUB_TOKEN.",
  },
];

export const MONITORED_SOURCES = FRESHNESS_RULES.map((r) => r.source);

export type FreshnessStatus = "ok" | "stale";
export type FreshnessAction = "unchanged" | "initialized" | "alerted" | "recovered" | "notify_failed";

export type FreshnessCheck = {
  source: string;
  status: FreshnessStatus;
  last_success: string | null;
  age_hours: number | null;
  threshold_hours: number;
  action: FreshnessAction;
  error?: string;
};

export type FreshnessReport = { notifier: string; checks: FreshnessCheck[] };

const HOUR_MS = 3_600_000;

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Instant de la dernière ingestion réussie de chaque source (`null` : jamais). */
export async function lastSuccessfulIngests(db: Db, sources: readonly string[] = MONITORED_SOURCES): Promise<Record<string, Date | null>> {
  const out: Record<string, Date | null> = {};
  for (const source of sources) {
    const rows = await db.executor.query<{ received_at: unknown }>(
      "SELECT received_at FROM ingest_log WHERE ok AND source = $1 ORDER BY received_at DESC LIMIT 1",
      [source],
    );
    out[source] = toDate(rows[0]?.received_at);
  }
  return out;
}

/** « 2 j 5 h », « 7 h ». */
export function formatAge(hours: number): string {
  const h = Math.floor(hours);
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24);
  const rest = h % 24;
  return rest === 0 ? `${d} j` : `${d} j ${rest} h`;
}

/** Heure de Paris, pour l'utilisateur (affichage seulement, jamais pour calculer une `date`). */
function formatInstant(d: Date): string {
  return `${d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} (Paris)`;
}

export function staleAlert(rule: FreshnessRule, last: Date | null, now: Date): Alert {
  const since = last
    ? `Aucune ingestion ${rule.label} réussie depuis ${formatAge((now.getTime() - last.getTime()) / HOUR_MS)} (dernière : ${formatInstant(last)}, seuil ${rule.thresholdHours} h).`
    : `Aucune ingestion ${rule.label} réussie n'a jamais été enregistrée.`;
  return {
    title: `Sillage : plus de données ${rule.label}`,
    message: `${since}\n${rule.hint}`,
    priority: "high",
    tags: ["warning"],
  };
}

export function recoveredAlert(rule: FreshnessRule, last: Date, changedAt: Date | null): Alert {
  const gap = changedAt ? ` Alerte levée le ${formatInstant(changedAt)}.` : "";
  return {
    title: `Sillage : données ${rule.label} rétablies`,
    message: `Ingestion ${rule.label} réussie le ${formatInstant(last)}.${gap}`,
    priority: "default",
    tags: ["white_check_mark"],
  };
}

type StateRow = { status: FreshnessStatus; changed_at: unknown };

export type CheckFreshnessOptions = {
  db: Db;
  notifier: Notifier;
  now?: Date;
  rules?: readonly FreshnessRule[];
  log?: EventLogger;
};

export async function checkFreshness(opts: CheckFreshnessOptions): Promise<FreshnessReport> {
  const { db, notifier } = opts;
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? FRESHNESS_RULES;
  const log = opts.log ?? logEvent;
  const ex = db.executor;
  const nowIso = now.toISOString();
  const lasts = await lastSuccessfulIngests(db, rules.map((r) => r.source));

  const checks: FreshnessCheck[] = [];
  for (const rule of rules) {
    const key = `freshness:${rule.source}`;
    const last = lasts[rule.source] ?? null;
    const ageHours = last ? (now.getTime() - last.getTime()) / HOUR_MS : null;
    const status: FreshnessStatus = ageHours === null || ageHours > rule.thresholdHours ? "stale" : "ok";
    const lastIso = last?.toISOString() ?? null;

    const prev = (await ex.query<StateRow>("SELECT status, changed_at FROM alert_state WHERE check_name = $1", [key]))[0];
    let action: FreshnessAction = "unchanged";
    let error: string | undefined;

    if (prev?.status === status) {
      await ex.query("UPDATE alert_state SET checked_at = $2::timestamptz, last_success_at = $3::timestamptz WHERE check_name = $1", [key, nowIso, lastIso]);
    } else if (!prev && status === "ok") {
      // Premier contrôle, tout va bien : on mémorise sans notifier.
      await ex.query(
        `INSERT INTO alert_state (check_name, status, changed_at, last_success_at, checked_at)
         VALUES ($1, 'ok', $2::timestamptz, $3::timestamptz, $2::timestamptz) ON CONFLICT (check_name) DO NOTHING`,
        [key, nowIso, lastIso],
      );
      action = "initialized";
    } else {
      // Changement d'état : on le « réserve » d'abord (une exécution concurrente ne le verra plus),
      // puis on notifie ; si l'envoi échoue, on revient à l'état précédent.
      const claimed = prev
        ? await ex.query(
            `UPDATE alert_state SET status = $2, changed_at = $3::timestamptz, last_success_at = $4::timestamptz, checked_at = $3::timestamptz
             WHERE check_name = $1 AND status = $5 RETURNING check_name`,
            [key, status, nowIso, lastIso, prev.status],
          )
        : await ex.query(
            `INSERT INTO alert_state (check_name, status, changed_at, last_success_at, checked_at)
             VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $3::timestamptz) ON CONFLICT (check_name) DO NOTHING RETURNING check_name`,
            [key, status, nowIso, lastIso],
          );
      if (claimed.length > 0) {
        const alert = status === "stale" ? staleAlert(rule, last, now) : recoveredAlert(rule, last as Date, toDate(prev?.changed_at));
        try {
          await notifier.send(alert);
          action = status === "stale" ? "alerted" : "recovered";
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          action = "notify_failed";
          if (prev) {
            await ex.query("UPDATE alert_state SET status = $2, changed_at = $3::timestamptz WHERE check_name = $1", [
              key,
              prev.status,
              toDate(prev.changed_at)?.toISOString() ?? nowIso,
            ]);
          } else {
            await ex.query("DELETE FROM alert_state WHERE check_name = $1", [key]);
          }
        }
      }
    }

    const check: FreshnessCheck = {
      source: rule.source,
      status,
      last_success: lastIso,
      age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      threshold_hours: rule.thresholdHours,
      action,
      ...(error ? { error } : {}),
    };
    checks.push(check);
    log(action === "notify_failed" ? "error" : status === "stale" ? "warn" : "info", "freshness", {
      source: check.source,
      status: check.status,
      last_success: check.last_success,
      age_hours: check.age_hours,
      threshold_hours: check.threshold_hours,
      action: check.action,
      notifier: notifier.name,
      error: check.error,
    });
  }

  const failed = checks.filter((c) => c.action === "notify_failed");
  if (failed.length > 0) {
    throw new Error(`alerte non envoyée (${notifier.name}) pour ${failed.map((c) => c.source).join(", ")} : ${failed[0]?.error ?? ""}`);
  }
  return { notifier: notifier.name, checks };
}

/** Tâche `check-freshness` (jobs.ts, `GET /cron/check-freshness`). */
export function runFreshnessJob(opts: Partial<CheckFreshnessOptions> = {}): Promise<FreshnessReport> {
  return checkFreshness({ ...opts, db: opts.db ?? getDb(), notifier: opts.notifier ?? notifierFromEnv() });
}
