/**
 * Contrat commun des techniques du moteur v2.
 *
 * Une technique reçoit un `TechniqueInput` (données pures, sérialisables : il peut traverser
 * un `postMessage` vers un Worker) et dessine sur un contexte 2D carré de `size` pixels.
 * Même entrée → même image : pas de `Math.random`, pas d'horloge, pas de dépendance à la
 * fenêtre ; tout le hasard vient de `input.seed` (voir `rngFor`).
 */
import type { FamilyId, StyleId } from "@sillage/shared";
import type { DayInput } from "../engine/day";
import type { Norms } from "../engine/normalize";
import type { Ctx2D } from "../engine/render-canvas";

export type { Ctx2D };

/** Météo du jour. Chaque champ peut manquer : les techniques utilisent alors `FALLBACKS`. */
export interface WeatherInput {
  temp_min: number | null;
  temp_max: number | null;
  precip_mm: number | null;
  wind_kmh: number | null;
  /** D'où vient le vent, en degrés (270 = ouest). */
  wind_dir_deg: number | null;
  /** Couverture nuageuse 0–1. */
  cloud: number | null;
}

/** Une palette v2 : choisie par les données (saison, sommeil, température), indépendante de la technique. */
export interface PaletteV2 {
  id: string;
  /** Nom lisible, ex. « Été · lumineux ». */
  name: string;
  season: "hiver" | "printemps" | "ete" | "automne";
  mood: "nocturne" | "doux" | "lumineux" | "brume";
  /** Fond clair (ou sombre en humeur nocturne). */
  paper: string;
  /** Trait principal, contrasté sur `paper`. */
  ink: string;
  /** Fond sombre pour les techniques « de nuit » (attracteur, réseau…). */
  night: string;
  /** Cinq couleurs d'accent, de la plus froide à la plus chaude. */
  colors: [string, string, string, string, string];
}

export interface TechniqueInput {
  date: string;
  /** Seed de l'œuvre : `seedFromDate(date)`, comme la v1. */
  seed: number;
  style: StyleId;
  /** La journée (tout à `null` si absente de la base). */
  day: DayInput;
  /** Centiles 0–1 par rapport aux 90 jours précédents (`null` = mesure absente, jamais 0). */
  norms: { steps: number | null; sleep: number | null; commits: number | null };
  /** Normes complètes au format v1 (la technique Marée recompose l'œuvre v1 avec). */
  v1Norms: Norms;
  palette: PaletteV2;
  /** `null` : pas de météo pour ce jour (valeurs de repli, voir `FALLBACKS`). */
  weather: WeatherInput | null;
  /** 24 valeurs, ou `null` si les pas horaires n'existent pas (profil de repli). */
  hourlySteps: number[] | null;
  /** Phase de lune 0–1 (0 = nouvelle, 0,5 = pleine), calculée depuis la date. */
  moon: number;
  /** Durée du jour à Paris, en heures (saison). */
  dayLengthHours: number;
}

/** Une ligne de la fiche « quelle donnée a piloté quel paramètre ». */
export interface ExplainLine {
  /** Paramètre visuel, ex. « Paramètre a de l'attracteur ». */
  param: string;
  /** Donnée source, ex. « Pas (62ᵉ centile) ». */
  source: string;
  /** Valeur obtenue, ex. « −1,75 ». */
  value: string;
}

export interface RenderOptions {
  /** « preview » : miniature de galerie, moins d'itérations (même composition). */
  quality?: "full" | "preview";
}

export interface Technique {
  id: StyleId;
  family: FamilyId;
  name: string;
  /** Procédé, en quelques mots : « chaos déterministe (Clifford) ». */
  process: string;
  /** false : rendu provisoire (technique pas encore portée depuis les esquisses). */
  ported: boolean;
  /** Plusieurs secondes de calcul : à rendre dans un Worker (voir `render.ts`). */
  heavy: boolean;
  /** Plus grand PNG proposé à l'export (les techniques en pixels coûtent cher en mémoire). */
  maxExportSize: number;
  /** true : la technique garde sa propre palette (Marée = palette v1) au lieu de la palette v2. */
  ownPalette?: boolean;
  /** Présent seulement si la technique sait produire un SVG (sinon le bouton est masqué). */
  toSvg?: (input: TechniqueInput) => string;
  render(ctx: Ctx2D, size: number, input: TechniqueInput, options?: RenderOptions): void | Promise<void>;
  explain(input: TechniqueInput): ExplainLine[];
}
