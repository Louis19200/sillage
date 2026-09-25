/**
 * Contexte d'une journée (phase 8) : position, météo, indice géomagnétique Kp,
 * phase de lune. Contrat additif : voir docs/API.md (« Contexte de la journée »).
 *
 * Ce module n'importe pas `./index` (qui le réexporte) pour éviter un cycle
 * d'imports : il redéfinit donc son propre motif de date.
 */
import { z } from "zod";

const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "format attendu : YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "date inexistante");

/** Heure locale « HH:MM » (lever / coucher du soleil, dans le fuseau du lieu). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "format attendu : HH:MM");

/** Précision gardée pour une position : 2 décimales, soit environ 1 km. */
export const LOCATION_DECIMALS = 2;

/** Arrondit une coordonnée à `LOCATION_DECIMALS` décimales (jamais plus précis). */
export function roundCoord(value: number): number {
  const f = 10 ** LOCATION_DECIMALS;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

// ---------------------------------------------------------------------------
// POST /ingest/location
// ---------------------------------------------------------------------------

/**
 * Position d'une journée, envoyée par le téléphone. `date` est la date locale
 * résolue sur le téléphone. Le serveur arrondit à 2 décimales avant d'écrire.
 */
export const LocationDay = z
  .object({
    date: LocalDate,
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  })
  .strict();
export type LocationDay = z.infer<typeof LocationDay>;

/** Corps de `POST /ingest/location` : 1 à 400 journées. */
export const LocationIngestBody = z.object({
  days: z.array(LocationDay).min(1).max(400),
});
export type LocationIngestBody = z.infer<typeof LocationIngestBody>;

// ---------------------------------------------------------------------------
// Champ `context` de GET /day/:date et GET /range
// ---------------------------------------------------------------------------

/**
 * Contexte stocké d'une journée (`daily_context`). Chaque valeur peut être
 * `null` (absente) ; `0` est une vraie valeur (0 mm de pluie, Kp 0).
 * Les coordonnées ne sont **pas** renvoyées en lecture (le jeton de lecture
 * finit dans le bundle public de la page d'art) : seule leur provenance l'est.
 */
export const DayContext = z.object({
  /** Provenance de la position utilisée : téléphone, « maison » (HOME_LAT/HOME_LON), ou inconnue. */
  location_source: z.enum(["phone", "home"]).nullable(),
  /** °C, au dixième. */
  temp_min: z.number().nullable(),
  temp_max: z.number().nullable(),
  /** Cumul de précipitations, mm. */
  precip_mm: z.number().nonnegative().nullable(),
  /** Vent maximal à 10 m, km/h. */
  wind_max_kmh: z.number().nonnegative().nullable(),
  /** Direction dominante du vent (d'où il vient), degrés 0–360. */
  wind_dir_deg: z.number().int().min(0).max(360).nullable(),
  /** Couverture nuageuse moyenne, %. */
  cloud_mean: z.number().int().min(0).max(100).nullable(),
  /** Durée d'ensoleillement, minutes. */
  sunshine_min: z.number().int().min(0).max(1440).nullable(),
  /** Lever / coucher du soleil, heure locale du lieu (« HH:MM »). */
  sunrise: LocalTime.nullable(),
  sunset: LocalTime.nullable(),
  /** Code météo WMO (0 = ciel clair … 99 = orage avec grêle). */
  weather_code: z.number().int().min(0).max(99).nullable(),
  /** Indice géomagnétique Kp maximal de la journée (0 à 9, par tiers). */
  kp_max: z.number().min(0).max(9).nullable(),
  updated_at: z.string().datetime({ offset: true }),
});
export type DayContext = z.infer<typeof DayContext>;

// ---------------------------------------------------------------------------
// Phase de lune (calculée, jamais stockée)
// ---------------------------------------------------------------------------

/** Durée moyenne d'une lunaison, en jours. */
export const SYNODIC_MONTH_DAYS = 29.530588853;

export type MoonPhase = {
  /** 0 = nouvelle lune, 0,25 = premier quartier, 0,5 = pleine lune, 0,75 = dernier quartier (0 ≤ phase < 1). */
  phase: number;
  /** Fraction éclairée du disque, 0 à 1. */
  illumination: number;
  /** Âge de la lune depuis la dernière nouvelle lune, en jours (0 à ~29,5). */
  age_days: number;
  /** Phase croissante (de la nouvelle à la pleine lune). */
  waxing: boolean;
};

const RAD = Math.PI / 180;
const mod360 = (x: number) => ((x % 360) + 360) % 360;

/**
 * Phase de lune d'une journée `YYYY-MM-DD`, évaluée à 12:00 UTC ce jour-là
 * (convention fixe : la même date donne toujours la même phase).
 *
 * Élongation Lune–Soleil à partir des longitudes écliptiques apparentes, avec
 * les principaux termes périodiques (équation du centre, évection, variation,
 * équation annuelle) : erreur de quelques heures sur l'instant des phases, bien
 * en dessous de la demi-journée d'écart due à l'heure d'évaluation.
 */
export function moonPhase(date: string): MoonPhase {
  const parsed = LocalDate.safeParse(date);
  if (!parsed.success) throw new Error(`moonPhase : date invalide ${JSON.stringify(date)} (attendu YYYY-MM-DD)`);
  const t = Date.parse(`${date}T12:00:00Z`);
  const d = t / 86_400_000 + 2440587.5 - 2451545.0; // jours depuis J2000.0

  // Soleil
  const g = mod360(357.528 + 0.9856003 * d); // anomalie moyenne
  const ls = mod360(280.46 + 0.9856474 * d); // longitude moyenne
  const lambdaSun = ls + 1.915 * Math.sin(g * RAD) + 0.02 * Math.sin(2 * g * RAD);

  // Lune
  const lm = mod360(218.316 + 13.176396 * d); // longitude moyenne
  const mm = mod360(134.963 + 13.064993 * d); // anomalie moyenne
  const dd = mod360(lm - ls); // élongation moyenne
  const lambdaMoon =
    lm +
    6.289 * Math.sin(mm * RAD) +
    1.274 * Math.sin((2 * dd - mm) * RAD) +
    0.658 * Math.sin(2 * dd * RAD) +
    0.214 * Math.sin(2 * mm * RAD) -
    0.186 * Math.sin(g * RAD);

  const elongation = mod360(lambdaMoon - lambdaSun);
  const phase = elongation / 360;
  return {
    phase,
    illumination: (1 - Math.cos(elongation * RAD)) / 2,
    age_days: phase * SYNODIC_MONTH_DAYS,
    waxing: phase < 0.5,
  };
}
