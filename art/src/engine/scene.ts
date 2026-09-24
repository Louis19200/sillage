/**
 * Une `Scene` est la description complète, sérialisable (JSON pur), d'une œuvre.
 * Repère logique fixe : 1000 × 1000, origine en haut à gauche, y vers le bas.
 * N'importe quel moteur (p5, SVG, canvas) peut la dessiner à n'importe quelle taille
 * en multipliant les coordonnées par `taille / SCENE_SIZE`.
 */

export const SCENE_SIZE = 1000;

/** Couleur sRGB `#rrggbb` + opacité séparée (pratique pour SVG : `fill` + `fill-opacity`). */
export interface Paint {
  color: string;
  alpha: number;
}

export interface GradientStop {
  /** Position 0–1 le long du dégradé. */
  offset: number;
  paint: Paint;
}

export interface Stroke {
  paint: Paint;
  weight: number;
  /** Motif de pointillés [trait, espace, …] en unités logiques. Absent = trait continu. */
  dash?: number[];
}

interface Base {
  /** Rôle sémantique de la primitive (« sky », « wake », « stone »…), utile aux exports et aux tests. */
  layer: string;
}

/** Dégradé linéaire qui remplit tout le cadre, de (x1, y1) vers (x2, y2). */
export interface LinearGradientPrim extends Base {
  kind: "linear-gradient";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}

/** Disque de dégradé radial centré en (cx, cy), transparent au-delà de `r`. */
export interface RadialGradientPrim extends Base {
  kind: "radial-gradient";
  cx: number;
  cy: number;
  r: number;
  stops: GradientStop[];
}

export interface CirclePrim extends Base {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  fill?: Paint;
  stroke?: Stroke;
}

/** Courbe lisse passant par ses points (Catmull-Rom), ouverte. */
export interface CurvePrim extends Base {
  kind: "curve";
  points: [number, number][];
  stroke: Stroke;
}

/** Polygone fermé (peut être lissé en Catmull-Rom fermé si `smooth`). */
export interface PolygonPrim extends Base {
  kind: "polygon";
  points: [number, number][];
  smooth: boolean;
  fill?: Paint;
  stroke?: Stroke;
}

export type Primitive =
  | LinearGradientPrim
  | RadialGradientPrim
  | CirclePrim
  | CurvePrim
  | PolygonPrim;

export interface Scene {
  /** Toujours 1000 : le repère logique. */
  size: typeof SCENE_SIZE;
  /** Couleur de fond unie, peinte avant les primitives. */
  background: string;
  /** Primitives dans l'ordre de dessin (la première est au fond). */
  primitives: Primitive[];
  /** Métadonnées lisibles (date, seed, métriques absentes) : ne changent pas le rendu. */
  meta: {
    date: string;
    seed: number;
    missing: ("steps" | "sleep" | "commits")[];
  };
}
