/**
 * LE fichier à retoucher pour changer le caractère des œuvres.
 * Il traduit (valeurs brutes + valeurs normalisées) en paramètres visuels ;
 * `compose.ts` ne fait ensuite que de la géométrie.
 *
 * Correspondances :
 * - sommeil  → palette et luminosité (+ taille de l'astre ; heure du réveil → hauteur de l'astre)
 * - pas      → mouvement (turbulence du courant) et densité (nombre de sillages)
 * - commits  → nombre de formes (une pierre par commit), taille selon l'habitude
 *
 * Données absentes (`null`) : jamais traitées comme 0, toujours reconnaissables
 * (brume désaturée, traits en pointillés, cercles vides en pointillés).
 */
import type { DayInput } from "./day";
import type { Norms } from "./normalize";
import { mixOklch, oklchToHex, type Oklch } from "./color";
import type { Rng } from "./random";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/* ------------------------------------------------------------------ */
/* Sommeil → palette et luminosité                                     */
/* ------------------------------------------------------------------ */

interface PaletteSpec {
  skyTop: Oklch;
  skyBottom: Oklch;
  /** Couleur des sillages. */
  ink: Oklch;
  /** Couleur des pierres (commits). */
  stone: Oklch;
  /** Astre (lune la nuit, soleil le jour). */
  orb: Oklch;
  /** Halo autour de l'astre. */
  glow: Oklch;
}

export interface Palette {
  skyTop: string;
  skyBottom: string;
  ink: string;
  stone: string;
  stoneRim: string;
  /** Reflet de l'astre sur les pierres. */
  stoneLight: string;
  orb: string;
  glow: string;
  /** Fond clair (encre sombre) ou fond sombre (encre claire). */
  mode: "night" | "day" | "mist";
}

/**
 * Quatre ancres. Sous l'habitude (sommeil normalisé < 0,5) l'œuvre est nocturne,
 * au-dessus elle est diurne : on lit d'un coup d'œil « ai-je bien dormi ? ».
 * À l'intérieur de chaque famille, l'interpolation est continue en OKLCH.
 */
const NIGHT_DEEP: PaletteSpec = {
  skyTop: { l: 0.16, c: 0.03, h: 275 },
  skyBottom: { l: 0.27, c: 0.055, h: 305 },
  ink: { l: 0.86, c: 0.035, h: 270 },
  stone: { l: 0.6, c: 0.09, h: 15 },
  orb: { l: 0.9, c: 0.025, h: 95 },
  glow: { l: 0.42, c: 0.06, h: 290 },
};
const NIGHT_BLUE: PaletteSpec = {
  skyTop: { l: 0.25, c: 0.055, h: 255 },
  skyBottom: { l: 0.43, c: 0.07, h: 215 },
  ink: { l: 0.92, c: 0.03, h: 200 },
  stone: { l: 0.76, c: 0.11, h: 65 },
  orb: { l: 0.95, c: 0.04, h: 90 },
  glow: { l: 0.55, c: 0.07, h: 220 },
};
const DAY_PALE: PaletteSpec = {
  skyTop: { l: 0.82, c: 0.045, h: 220 },
  skyBottom: { l: 0.94, c: 0.028, h: 85 },
  ink: { l: 0.36, c: 0.065, h: 240 },
  stone: { l: 0.6, c: 0.12, h: 40 },
  orb: { l: 0.91, c: 0.075, h: 85 },
  glow: { l: 0.96, c: 0.05, h: 85 },
};
const DAY_GOLD: PaletteSpec = {
  skyTop: { l: 0.84, c: 0.075, h: 55 },
  skyBottom: { l: 0.95, c: 0.03, h: 95 },
  ink: { l: 0.36, c: 0.08, h: 25 },
  stone: { l: 0.55, c: 0.14, h: 20 },
  orb: { l: 0.78, c: 0.13, h: 50 },
  glow: { l: 0.95, c: 0.07, h: 75 },
};
/** Sommeil inconnu : brume presque neutre. */
const MIST: PaletteSpec = {
  skyTop: { l: 0.7, c: 0.006, h: 250 },
  skyBottom: { l: 0.86, c: 0.005, h: 90 },
  ink: { l: 0.36, c: 0.008, h: 250 },
  stone: { l: 0.6, c: 0.01, h: 60 },
  orb: { l: 0.95, c: 0.0, h: 0 },
  glow: { l: 0.93, c: 0.004, h: 90 },
};

/** Décalage de teinte aléatoire (seedé) appliqué à toute la palette, en degrés. */
export const HUE_JITTER_DEG = 12;

function mixSpec(a: PaletteSpec, b: PaletteSpec, t: number): PaletteSpec {
  return {
    skyTop: mixOklch(a.skyTop, b.skyTop, t),
    skyBottom: mixOklch(a.skyBottom, b.skyBottom, t),
    ink: mixOklch(a.ink, b.ink, t),
    stone: mixOklch(a.stone, b.stone, t),
    orb: mixOklch(a.orb, b.orb, t),
    glow: mixOklch(a.glow, b.glow, t),
  };
}

export function paletteFor(sleep: number | null, rng: Rng): Palette {
  const shift = rng.range(-HUE_JITTER_DEG, HUE_JITTER_DEG);
  let spec: PaletteSpec;
  let mode: Palette["mode"];
  if (sleep === null) {
    spec = MIST;
    mode = "mist";
  } else if (sleep < 0.5) {
    spec = mixSpec(NIGHT_DEEP, NIGHT_BLUE, sleep / 0.5);
    mode = "night";
  } else {
    spec = mixSpec(DAY_PALE, DAY_GOLD, (sleep - 0.5) / 0.5);
    mode = "day";
  }
  const hex = (c: Oklch, dl = 0) => oklchToHex({ l: c.l + dl, c: c.c, h: c.h + shift });
  return {
    skyTop: hex(spec.skyTop),
    skyBottom: hex(spec.skyBottom),
    ink: hex(spec.ink),
    stone: hex(spec.stone),
    stoneRim: hex(spec.stone, mode === "night" ? 0.14 : -0.14),
    stoneLight: hex(spec.stone, 0.13),
    orb: hex(spec.orb),
    glow: hex(spec.glow),
    mode,
  };
}

/* ------------------------------------------------------------------ */
/* Sommeil → astre                                                      */
/* ------------------------------------------------------------------ */

export interface OrbParams {
  known: boolean;
  cx: number;
  cy: number;
  r: number;
}

/** Heure locale du réveil en heures décimales, lue telle quelle dans la chaîne ISO. */
function wakeHour(sleepEnd: string | null): number | null {
  if (sleepEnd === null) return null;
  const m = /T(\d{2}):(\d{2})/.exec(sleepEnd);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

export function orbFor(day: DayInput, sleep: number | null, rng: Rng): OrbParams {
  const cx = rng.range(240, 760);
  const fallbackY = rng.range(200, 330);
  if (sleep === null) return { known: false, cx, cy: fallbackY, r: 70 };
  // Réveil tôt (5 h 30) → astre bas ; réveil tard (10 h 30) → astre haut.
  const h = wakeHour(day.sleep_end);
  const cy = h === null ? fallbackY : lerp(430, 150, clamp01((h - 5.5) / 5));
  return { known: true, cx, cy, r: lerp(48, 110, sleep) };
}

/* ------------------------------------------------------------------ */
/* Pas → mouvement et densité                                          */
/* ------------------------------------------------------------------ */

export interface FlowParams {
  /** moving : on a marché ; still : 0 pas, eau dormante ; unknown : pas non mesurés. */
  state: "moving" | "still" | "unknown";
  /** Nombre de sillages (densité). */
  lines: number;
  /** Amplitude des remous, relative à la vitesse du courant (mouvement). */
  turbulence: number;
  /** Fréquence spatiale du bruit (plus haut = remous plus serrés). */
  noiseScale: number;
  /** Épaisseur de base des traits, en unités logiques. */
  weight: number;
  /** Direction générale du courant, en radians. */
  angle: number;
}

export function flowFor(steps: number | null, norm: number | null, rng: Rng): FlowParams {
  const angle = rng.range(-0.22, 0.22);
  if (steps === null || norm === null) {
    return { state: "unknown", lines: 30, turbulence: 0.3, noiseScale: 0.0025, weight: 1.4, angle };
  }
  if (steps === 0) {
    return { state: "still", lines: 13, turbulence: 0, noiseScale: 0, weight: 1.1, angle: 0 };
  }
  return {
    state: "moving",
    lines: Math.round(lerp(26, 120, norm)),
    turbulence: lerp(0.12, 0.8, norm),
    noiseScale: lerp(0.0017, 0.0042, norm),
    weight: lerp(2.0, 1.0, norm),
    angle,
  };
}

/* ------------------------------------------------------------------ */
/* Commits → nombre de formes                                          */
/* ------------------------------------------------------------------ */

export interface StoneParams {
  /** known : une pierre par commit ; unknown : quelques cercles fantômes en pointillés. */
  state: "known" | "unknown";
  count: number;
  /** Rayon moyen des pierres. */
  radius: number;
}

/** Au-delà, on plafonne pour que l'œuvre reste lisible. */
export const MAX_STONES = 40;
export const GHOST_STONES = 3;

export function stonesFor(commits: number | null, norm: number | null): StoneParams {
  if (commits === null || norm === null) return { state: "unknown", count: GHOST_STONES, radius: 34 };
  const count = Math.min(commits, MAX_STONES);
  // Journée chargée par rapport à mes habitudes → pierres plus grosses,
  // mais on rétrécit quand il y en a beaucoup pour laisser respirer.
  const crowd = count > 12 ? Math.sqrt(12 / count) : 1;
  return { state: "known", count, radius: lerp(16, 34, norm) * crowd };
}

export function derivedParams(day: DayInput, norms: Norms, rng: Rng) {
  return {
    palette: paletteFor(norms.sleep_minutes.value, rng.fork("palette")),
    orb: orbFor(day, norms.sleep_minutes.value, rng.fork("orb")),
    flow: flowFor(day.steps, norms.steps.value, rng.fork("flow")),
    stones: stonesFor(day.commits, norms.commits.value),
  };
}
export type VisualParams = ReturnType<typeof derivedParams>;
