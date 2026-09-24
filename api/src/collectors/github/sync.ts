/**
 * Synchronisation GitHub → `daily_metrics.commits`.
 *
 * `syncGithub({ from, to })` lit les contributions par jour, les écrit en un
 * seul upsert (transaction) et journalise le résultat dans `ingest_log`.
 * Idempotent : relancer sur la même plage réécrit les mêmes valeurs.
 * Sans état en mémoire : utilisable tel quel dans une fonction serverless.
 */
import { getDb, type Db } from "../../db";
import { fetchContributions, redact, type FetchLike } from "./client";

export const GITHUB_SOURCE = "github";
const DAY_MS = 24 * 60 * 60 * 1000;

export type SyncGithubOptions = {
  from: Date;
  to: Date;
  /** Par défaut : `process.env.GITHUB_TOKEN`. */
  token?: string;
  /** Par défaut : `process.env.GITHUB_LOGIN`. */
  login?: string;
  fetch?: FetchLike;
  /** Par défaut : la base partagée (`getDb()`, `DATABASE_URL` ou `setDb`). */
  db?: Db;
};

/** Résumé JSON renvoyé par la synchro (et par la tâche `github-sync`). */
export type SyncGithubResult = {
  source: "github";
  from: string;
  to: string;
  days_written: number;
  first_date: string | null;
  last_date: string | null;
};

/** Plage « les `n` derniers jours » : de `now - n jours` à `now`. */
export function lastDays(n: number, now: Date = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - n * DAY_MS), to: new Date(now.getTime()) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function syncGithub(opts: SyncGithubOptions): Promise<SyncGithubResult> {
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? "";
  const login = opts.login ?? process.env.GITHUB_LOGIN ?? "";
  const db = opts.db ?? getDb();
  const range = { from: opts.from.toISOString(), to: opts.to.toISOString() };

  let written = 0;
  let first: string | null = null;
  let last: string | null = null;
  try {
    if (!token) throw new Error("GITHUB_TOKEN manquant (token GitHub en lecture seule, voir api/README.md)");
    if (!login) throw new Error("GITHUB_LOGIN manquant (identifiant GitHub dont on lit les contributions)");

    // Tout est lu avant d'écrire : une erreur sur une requête n'écrit rien.
    const days = await fetchContributions({ token, login, fetch: opts.fetch }, opts.from, opts.to);
    first = days[0]?.date ?? null;
    last = days.at(-1)?.date ?? null;
    // Une seule transaction : tout ou rien.
    written = await db.upsertCommits(days);
  } catch (err) {
    const message = redact(errorMessage(err), token);
    try {
      await db.logIngest({ source: GITHUB_SOURCE, days_count: 0, first_date: first, last_date: last, ok: false, error: message });
    } catch (logErr) {
      console.error("github : impossible de journaliser l'échec", redact(errorMessage(logErr), token));
    }
    throw new Error(`synchro GitHub en échec : ${message}`);
  }

  await db.logIngest({ source: GITHUB_SOURCE, days_count: written, first_date: first, last_date: last, ok: true, error: null });
  return { source: GITHUB_SOURCE, ...range, days_written: written, first_date: first, last_date: last };
}

/** Tâche nocturne `github-sync` (jobs.ts, route cron) : les 7 derniers jours, une requête GraphQL. */
export function runGithubSyncJob(now: Date = new Date()): Promise<SyncGithubResult> {
  return syncGithub(lastDays(7, now));
}
