/**
 * Synchronisation : calcule les dernières journées complètes, les envoie en un seul appel
 * à `POST /ingest/health`, puis mémorise le résultat.
 *
 * Tout est injecté (lecteur Health Connect, fetch, stockage, horloge) : ce module se
 * teste avec jest, sans téléphone ni réseau. Le câblage réel est dans `settings.ts`.
 */
import { ingestHealthDays, type FetchLike, type IngestErrorKind } from "./api";
import type { HealthDay } from "@sillage/shared";

import { computeLastCompleteDays, type ComputedHealthDay, type HealthReader, type LocalDate } from "./days";

/** Bouton « Synchroniser » : les 7 dernières journées complètes (hier compris). */
export const SYNC_DAYS = 7;
/**
 * Bouton « Backfill » : 30 journées, en un seul appel (l'API accepte jusqu'à 400).
 * Health Connect ne donne accès qu'aux 30 jours précédant l'octroi de la permission :
 * aller au-delà n'apporterait que des `null`, sauf avec la permission d'historique.
 */
export const BACKFILL_DAYS = 30;

export type SyncKind = "sync" | "backfill";

/** Ce qu'on mémorise après chaque tentative (et qu'on affiche). Aucun secret ici. */
export interface SyncRecord {
  kind: SyncKind;
  /** Instant de la tentative, ISO 8601 UTC (sert à l'affichage, jamais à calculer une date). */
  at: string;
  ok: boolean;
  /** Première et dernière journée envoyées (ou qu'on a tenté d'envoyer). */
  from: LocalDate | null;
  to: LocalDate | null;
  days: number;
  upserted: number | null;
  errorKind: IngestErrorKind | "read" | null;
  message: string;
  details: string[];
}

export interface SyncState {
  lastAttempt: SyncRecord | null;
  lastSuccess: SyncRecord | null;
}

export interface Settings {
  apiUrl: string;
  token: string;
}

export interface SyncDeps {
  reader: HealthReader;
  fetch: FetchLike;
  loadSettings(): Promise<Settings>;
  loadState(): Promise<SyncState>;
  saveState(state: SyncState): Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
}

/**
 * Ce qu'on envoie vraiment. Une valeur absente de Health Connect n'est pas envoyée
 * (champ omis = colonne intacte côté API) : une lecture vide (autorisation retirée,
 * appli source déconnectée) ne peut donc jamais effacer des valeurs déjà en base.
 * Une journée sans aucune valeur n'est pas envoyée du tout ; pour l'art, une ligne
 * absente et une ligne à `null` se lisent de la même façon.
 */
export function toIngestDays(days: readonly ComputedHealthDay[]): HealthDay[] {
  const out: HealthDay[] = [];
  for (const day of days) {
    const kept: HealthDay = { date: day.date };
    if (day.steps !== null) kept.steps = day.steps;
    if (day.sleep_minutes !== null) {
      kept.sleep_minutes = day.sleep_minutes;
      kept.sleep_start = day.sleep_start;
      kept.sleep_end = day.sleep_end;
    }
    if (Object.keys(kept).length > 1) out.push(kept);
  }
  return out;
}

/** Les deux types de synchro ne diffèrent que par le nombre de jours. */
export function daysFor(kind: SyncKind): number {
  return kind === "backfill" ? BACKFILL_DAYS : SYNC_DAYS;
}

/**
 * Lit Health Connect, envoie, mémorise. Ne lève pas : l'erreur (lecture, réseau, API)
 * est dans le `SyncRecord` renvoyé, qui est aussi enregistré comme dernière tentative.
 */
export async function runSync(kind: SyncKind, deps: SyncDeps): Promise<SyncRecord> {
  const now = (deps.now ?? (() => new Date()))();
  const count = daysFor(kind);
  const base = { kind, at: now.toISOString() };

  let record: SyncRecord;
  try {
    const computed = await computeLastCompleteDays(deps.reader, count, now);
    const from = computed[0]?.date ?? null;
    const to = computed[computed.length - 1]?.date ?? null;
    const days = toIngestDays(computed);
    const empty = computed.length - days.length;

    if (days.length === 0) {
      record = {
        ...base,
        ok: false,
        from,
        to,
        days: 0,
        upserted: null,
        errorKind: "read",
        message:
          `Health Connect n'a renvoyé aucune donnée (pas ni sommeil) pour ces ${computed.length} jours : rien n'a été envoyé. ` +
          "Vérifie qu'une appli (Samsung Health, Google Fit, ta montre…) écrit bien dans Health Connect : bouton « Diagnostic Health Connect ».",
        details: [],
      };
    } else {
      const settings = await deps.loadSettings();
      const outcome = await ingestHealthDays({
        baseUrl: settings.apiUrl,
        token: settings.token,
        days,
        fetch: deps.fetch,
        ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      });
      const skipped = empty > 0 ? ` ${empty} journée${empty > 1 ? "s" : ""} sans données, non envoyée${empty > 1 ? "s" : ""}.` : "";
      record = outcome.ok
        ? {
            ...base,
            ok: true,
            from,
            to,
            days: days.length,
            upserted: outcome.upserted,
            errorKind: null,
            message: `${outcome.upserted} journée${outcome.upserted > 1 ? "s" : ""} enregistrée${outcome.upserted > 1 ? "s" : ""}.${skipped}`,
            details: [],
          }
        : {
            ...base,
            ok: false,
            from,
            to,
            days: days.length,
            upserted: null,
            errorKind: outcome.kind,
            message: outcome.message,
            details: outcome.details,
          };
    }
  } catch (e) {
    record = {
      ...base,
      ok: false,
      from: null,
      to: null,
      days: 0,
      upserted: null,
      errorKind: "read",
      message: `Lecture impossible : ${e instanceof Error ? e.message : String(e)}`,
      details: [],
    };
  }

  try {
    const previous = await deps.loadState();
    await deps.saveState({
      lastAttempt: record,
      lastSuccess: record.ok ? record : previous.lastSuccess,
    });
  } catch {
    // Ne pas masquer le résultat de la synchro parce que la mémorisation a échoué.
  }
  return record;
}

/** Relit un état mémorisé ; toute valeur illisible donne un état vide plutôt qu'une erreur. */
export function parseSyncState(raw: string | null): SyncState {
  const empty: SyncState = { lastAttempt: null, lastSuccess: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<SyncState> | null;
    if (typeof v !== "object" || v === null) return empty;
    return {
      lastAttempt: isRecord(v.lastAttempt) ? v.lastAttempt : null,
      lastSuccess: isRecord(v.lastSuccess) ? v.lastSuccess : null,
    };
  } catch {
    return empty;
  }
}

function isRecord(v: unknown): v is SyncRecord {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as SyncRecord).at === "string" &&
    typeof (v as SyncRecord).ok === "boolean" &&
    typeof (v as SyncRecord).message === "string" &&
    Array.isArray((v as SyncRecord).details)
  );
}
