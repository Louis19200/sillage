/**
 * Registre des 10 techniques. Deux sont portées (Marée, Attracteur) ; les huit autres ont un
 * rendu provisoire en attendant leur module (voir `_template.ts`). Pour en porter une :
 * remplacer sa ligne `createPlaceholder(...)` par l'import du module.
 */
import { STYLES, type StyleId } from "@sillage/shared";
import type { Technique } from "../types";
import { attracteur } from "./attracteur";
import { maree } from "./maree";
import { createPlaceholder } from "./placeholder";

export const TECHNIQUES: Record<StyleId, Technique> = {
  maree,
  attracteur,
  pelage: createPlaceholder("pelage", "organique", "Pelage", "réaction-diffusion (Gray-Scott)"),
  corail: createPlaceholder("corail", "organique", "Corail", "croissance (colonisation de l'espace)"),
  harmonographe: createPlaceholder("harmonographe", "mathematique", "Harmonographe", "courbe paramétrique amortie"),
  vitrail: createPlaceholder("vitrail", "geometrique", "Vitrail", "géométrie (Voronoï)"),
  constructif: createPlaceholder("constructif", "geometrique", "Constructif", "composition géométrique à règles"),
  reseau: createPlaceholder("reseau", "organique", "Réseau", "vie artificielle (physarum)"),
  hachures: createPlaceholder("hachures", "geometrique", "Hachures", "art du tracé (plotter)"),
  pixels: createPlaceholder("pixels", "numerique", "Pixels", "glitch (tri de pixels)"),
};

export function techniqueFor(style: StyleId): Technique {
  return TECHNIQUES[style];
}

export const ALL_TECHNIQUES: readonly Technique[] = STYLES.map((s) => TECHNIQUES[s]);
