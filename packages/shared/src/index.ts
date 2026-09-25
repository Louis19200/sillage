/**
 * Contrat partagé entre api/, app/ et art/.
 * Toute modification ici est une modification d'interface : voir docs/AGENTS.md
 * (section « Changer un contrat ») avant d'y toucher.
 */
import { z } from "zod";
import { STYLES } from "./selection";

export * from "./selection";

/** Date calendaire locale, déjà résolue côté téléphone : "2026-09-24". */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "format attendu : YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "date inexistante");
export type IsoDate = z.infer<typeof IsoDate>;

/** Horodatage avec décalage explicite : "2026-09-23T23:40:00+02:00". */
export const OffsetDateTime = z.string().datetime({ offset: true });

/**
 * Règle d'or : `null` = donnée absente (montre oubliée, pas de synchro),
 * `0` = vraiment zéro. Ne jamais convertir l'un en l'autre.
 */
const nullableCount = z.number().int().nonnegative().nullable();

/** Identifiant d'une des 10 techniques du moteur v2 (voir `selection/constants.ts`). */
export const StyleIdSchema = z.enum(STYLES);

/**
 * Explication du choix d'un style figé (moteur v2) : `SelectionExplain` (selection/select.ts)
 * + la date du gel et la version du moteur. Validée en surface : le détail suit
 * `selection_version`, et un client ancien doit pouvoir lire une version plus récente.
 */
export const StyleExplain = z
  .object({
    selection_version: z.number().int().positive(),
    style: StyleIdSchema,
    frozen_at: z.string().datetime({ offset: true }).optional(),
    engine_version: z.string().optional(),
  })
  .passthrough();
export type StyleExplain = z.infer<typeof StyleExplain>;

/** Une journée agrégée, telle que stockée dans `daily_metrics`. */
export const DailyMetrics = z.object({
  date: IsoDate,
  steps: nullableCount,
  sleep_minutes: nullableCount,
  sleep_start: OffsetDateTime.nullable(),
  sleep_end: OffsetDateTime.nullable(),
  commits: nullableCount,
  updated_at: z.string().datetime({ offset: true }),
  /** Moteur v2 : style figé de la journée (absent tant qu'elle n'est pas figée). */
  style: StyleIdSchema.optional(),
  /** Moteur v2 : comment ce style a été choisi (présent avec `style`). */
  style_explain: StyleExplain.optional(),
});
export type DailyMetrics = z.infer<typeof DailyMetrics>;

/**
 * Une journée santé envoyée par le téléphone.
 * Un champ omis n'est PAS modifié en base ; un champ à `null` efface la valeur.
 * Le sommeil est rattaché au jour du réveil (la nuit du 23 au 24 compte pour le 24).
 */
export const HealthDay = z.object({
  date: IsoDate,
  steps: nullableCount.optional(),
  sleep_minutes: nullableCount.optional(),
  sleep_start: OffsetDateTime.nullable().optional(),
  sleep_end: OffsetDateTime.nullable().optional(),
});
export type HealthDay = z.infer<typeof HealthDay>;

/** Corps de `POST /ingest/health` : une ou plusieurs journées (backfill). */
export const HealthIngestBody = z.object({
  days: z.array(HealthDay).min(1).max(400),
});
export type HealthIngestBody = z.infer<typeof HealthIngestBody>;

export const IngestResult = z.object({ upserted: z.number().int() });
export type IngestResult = z.infer<typeof IngestResult>;

/** Réponse de `GET /range?from=&to=` : jours présents en base, triés par date. */
export const RangeResponse = z.object({
  from: IsoDate,
  to: IsoDate,
  days: z.array(DailyMetrics),
});
export type RangeResponse = z.infer<typeof RangeResponse>;

/** En-tête d'authentification pour les routes d'écriture. */
export const AUTH_HEADER = "authorization"; // valeur : `Bearer <INGEST_TOKEN>`

/** Limite de `GET /range`, pour éviter les requêtes démesurées. */
export const MAX_RANGE_DAYS = 800;

// --- Phase 8 : contexte de la journée (météo, position, Kp, lune) ------------
// Additif : voir packages/shared/src/context.ts et docs/API.md.
export * from "./context";
import { DayContext } from "./context";

/**
 * Journée renvoyée par `GET /day/:date` et `GET /range` : `DailyMetrics` plus
 * `context` (objet, ou `null` si aucun contexte n'est encore stocké pour ce jour).
 * Champ optionnel : un client qui l'ignore continue de fonctionner.
 */
export const DailyMetricsWithContext = DailyMetrics.extend({
  context: DayContext.nullable().optional(),
});
export type DailyMetricsWithContext = z.infer<typeof DailyMetricsWithContext>;

export const RangeWithContextResponse = RangeResponse.extend({
  days: z.array(DailyMetricsWithContext),
});
export type RangeWithContextResponse = z.infer<typeof RangeWithContextResponse>;
