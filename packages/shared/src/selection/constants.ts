/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RÉGLAGES DU CHOIX DE LA TECHNIQUE (moteur v2)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Tout ce qui décide « quelle technique pour quel jour » est ici, et seulement ici :
 * la liste des styles, leurs familles, la formule du nombre clé, les tranches de pas,
 * la table des poids, les ajustements et les exclusions. Le code de `select.ts` ne
 * contient aucun nombre magique.
 *
 * ⚠ Changer une valeur change les œuvres des jours PAS ENCORE FIGÉS (les 3 derniers
 * jours, et tout jour que l'API n'a pas encore figé). Les jours figés ne bougent plus
 * jamais. Si tu changes la règle elle-même, incrémente `SELECTION_VERSION` : chaque
 * jour figé garde la version avec laquelle il a été choisi.
 */

/** Version de la formule de sélection. Stockée avec chaque style figé. */
export const SELECTION_VERSION = 1;

/* ─────────────────────────────── Styles ─────────────────────────────── */

/**
 * Les 10 techniques, dans l'ORDRE FIXE utilisé pour le tirage (cumul des poids).
 * Ne pas réordonner : cela changerait le style de tous les jours non figés.
 */
export const STYLES = [
  "maree",
  "attracteur",
  "pelage",
  "corail",
  "harmonographe",
  "vitrail",
  "constructif",
  "reseau",
  "hachures",
  "pixels",
] as const;
export type StyleId = (typeof STYLES)[number];

/** Nom affiché de chaque technique. */
export const STYLE_NAMES: Record<StyleId, string> = {
  maree: "Marée",
  attracteur: "Attracteur",
  pelage: "Pelage",
  corail: "Corail",
  harmonographe: "Harmonographe",
  vitrail: "Vitrail",
  constructif: "Constructif",
  reseau: "Réseau",
  hachures: "Hachures",
  pixels: "Pixels",
};

/* ────────────────────────────── Familles ────────────────────────────── */

export type FamilyId = "organique" | "mathematique" | "geometrique" | "numerique";

/** Familles : on ne tire jamais deux jours de suite dans la même famille. */
export const FAMILIES: Record<FamilyId, readonly StyleId[]> = {
  organique: ["maree", "corail", "reseau", "pelage"],
  mathematique: ["attracteur", "harmonographe"],
  geometrique: ["vitrail", "constructif", "hachures"],
  numerique: ["pixels"],
};

export const FAMILY_NAMES: Record<FamilyId, string> = {
  organique: "organique",
  mathematique: "mathématique",
  geometrique: "géométrique",
  numerique: "numérique",
};

/* ───────────────────────────── Nombre clé ───────────────────────────── */

/**
 * K = pas × 1000 + minuteDuRéveil × 10 + commits  (+ round(temp_max × 10) × 1e8 si connue)
 * u = partie fractionnaire de K × 0,6180339887498949 (nombre d'or − 1)
 *
 * - Une valeur absente compte pour 0 dans K (seulement dans K : ailleurs, absent ≠ 0).
 * - minuteDuRéveil = minute de la journée locale de `sleep_end` (07:57 → 477), 0 si absent.
 * - Journée sans aucune donnée (pas, sommeil, réveil et commits absents) : K = numéro du
 *   jour depuis l'origine de la chaîne (0 le premier jour).
 */
export const KEY = {
  stepsFactor: 1000,
  wakeFactor: 10,
  commitsFactor: 1,
  /** Température max arrondie au dixième (22,4 °C → 224), puis × 1e8. */
  tempTenthsFactor: 1e8,
  golden: 0.6180339887498949,
} as const;

/**
 * Fuseau utilisé pour lire l'heure du réveil quand `sleep_end` arrive en UTC (« …Z »),
 * ce que fait l'API (Postgres ne garde pas le décalage). Un horodatage avec décalage
 * explicite (« …+02:00 », comme l'envoie le téléphone et comme dans les fixtures) est
 * lu tel quel. Ainsi le navigateur et l'API trouvent la même minute.
 */
export const WAKE_TIME_ZONE = "Europe/Paris";

/* ─────────────────────────── Tranches de pas ─────────────────────────── */

export type BandId = "tres-calme" | "calme" | "normale" | "active" | "tres-active";

/**
 * Tranche de la journée selon le centile des pas par rapport aux 90 jours précédents.
 * Première tranche dont `below` est strictement supérieur au centile ; la dernière n'a pas de borne.
 */
export const STEP_BANDS: readonly { id: BandId; label: string; below: number | null }[] = [
  { id: "tres-calme", label: "très calme", below: 0.2 },
  { id: "calme", label: "calme", below: 0.4 },
  { id: "normale", label: "normale", below: 0.6 },
  { id: "active", label: "active", below: 0.8 },
  { id: "tres-active", label: "très active", below: null },
];

/** Tranche retenue quand les pas sont absents. */
export const MISSING_STEPS_BAND: BandId = "normale";

/* ──────────────────────────── Poids de base ──────────────────────────── */

/**
 * Poids de chaque technique selon la tranche de pas. Seuls les rapports comptent :
 * un poids de 4 face à un total de 20 donne 20 % de chances (avant ajustements et exclusions).
 */
export const BASE_WEIGHTS: Record<BandId, Record<StyleId, number>> = {
  "tres-calme": {
    harmonographe: 5, hachures: 4, pelage: 3, maree: 2, constructif: 2,
    vitrail: 1, attracteur: 1, corail: 1, reseau: 1, pixels: 0.5,
  },
  calme: {
    harmonographe: 4, hachures: 3, pelage: 3, maree: 3, constructif: 2,
    vitrail: 2, attracteur: 2, corail: 1, reseau: 1, pixels: 0.5,
  },
  normale: {
    maree: 3, vitrail: 3, constructif: 3, pelage: 2, attracteur: 2,
    corail: 2, harmonographe: 2, hachures: 2, reseau: 2, pixels: 0.5,
  },
  active: {
    corail: 4, reseau: 3, attracteur: 3, maree: 3, vitrail: 2,
    constructif: 2, pelage: 2, harmonographe: 1, hachures: 1, pixels: 0.5,
  },
  "tres-active": {
    reseau: 5, corail: 4, attracteur: 4, maree: 3, pelage: 2,
    vitrail: 2, constructif: 2, harmonographe: 1, hachures: 1, pixels: 0.5,
  },
};

/* ───────────────────────────── Ajustements ───────────────────────────── */

/**
 * Multiplicateurs appliqués aux poids de base (ils se cumulent).
 *
 * `metric` :
 *  - "sleep" / "commits" : comparés au CENTILE du jour (0–1) par rapport aux 90 jours avant ;
 *  - "precip_mm" / "wind_max_kmh" : comparés à la VALEUR BRUTE (mm, km/h).
 * `below` : strictement inférieur ; `above` : strictement supérieur ; `atLeast` : supérieur ou égal.
 * Une règle dont la donnée est absente ne s'applique pas (absent n'est jamais « bas »).
 *
 * Règles météo : prêtes mais sans effet tant que l'API ne fournit pas `precip_mm` /
 * `wind_max_kmh` (les jours déjà figés ne changeront pas quand elles arriveront).
 */
export interface AdjustmentRule {
  id: string;
  label: string;
  metric: "sleep" | "commits" | "precip_mm" | "wind_max_kmh";
  below?: number;
  above?: number;
  atLeast?: number;
  factors: Partial<Record<StyleId, number>>;
  /** Mettre à false pour couper une règle sans la supprimer. */
  enabled: boolean;
}

export const ADJUSTMENTS: readonly AdjustmentRule[] = [
  { id: "nuit-courte", label: "Nuit courte", metric: "sleep", below: 0.2, factors: { pixels: 6, attracteur: 1.5 }, enabled: true },
  { id: "longue-nuit", label: "Longue nuit", metric: "sleep", above: 0.8, factors: { harmonographe: 1.5, maree: 1.5 }, enabled: true },
  { id: "beaucoup-de-commits", label: "Beaucoup de commits", metric: "commits", above: 0.7, factors: { constructif: 1.5, vitrail: 1.5, hachures: 1.5 }, enabled: true },
  { id: "peu-de-commits", label: "Peu de commits", metric: "commits", below: 0.15, factors: { constructif: 0.6, vitrail: 0.6 }, enabled: true },
  // Météo (données à venir) : pluie ≥ 1 mm sur la journée, rafales/vent max ≥ 40 km/h.
  { id: "pluie", label: "Pluie", metric: "precip_mm", atLeast: 1, factors: { pelage: 1.5, vitrail: 1.5 }, enabled: true },
  { id: "vent-fort", label: "Vent fort", metric: "wind_max_kmh", atLeast: 40, factors: { maree: 1.5, reseau: 1.5 }, enabled: true },
];

/* ───────────────────────────── Exclusions ───────────────────────────── */

export const EXCLUSIONS = {
  /** Styles des N jours précédents interdits (hier et avant-hier). */
  previousDays: 2,
  /** Toute la famille du style d'hier est interdite. */
  familyOfYesterday: true,
} as const;

/* ─────────────────────────── Normalisation ─────────────────────────── */

/**
 * Même logique que la v1 (art/src/engine/normalize.ts) : rang percentile parmi les
 * valeurs non nulles des 90 jours qui PRÉCÈDENT le jour ; sous 14 points, courbe par
 * défaut autour d'une habitude (8 000 pas, 7 h 30, 4 commits).
 */
export const NORMALIZATION = {
  windowDays: 90,
  minPoints: 14,
  defaults: {
    steps: { median: 8000, steepness: 2 },
    sleep_minutes: { median: 450, steepness: 8 },
    commits: { median: 4, steepness: 1.5 },
  },
} as const;
