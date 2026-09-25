/**
 * Registre des 10 techniques. Celles qui ne sont pas encore portées ont un rendu provisoire
 * en attendant leur module (voir `_template.ts`). Pour en porter une : remplacer sa ligne
 * `createPlaceholder(...)` par l'import du module.
 */
import { STYLES, type StyleId } from "@sillage/shared";
import type { Technique } from "../types";
import { attracteur } from "./attracteur";
import { constructif } from "./constructif";
import { corail } from "./corail";
import { harmonographe } from "./harmonographe";
import { maree } from "./maree";
import { createPlaceholder } from "./placeholder";
import { hachures } from "./hachures";
import { pixels } from "./pixels";
import { vitrail } from "./vitrail";

export const TECHNIQUES: Record<StyleId, Technique> = {
  maree,
  attracteur,
  pelage: createPlaceholder("pelage", "organique", "Pelage", "réaction-diffusion (Gray-Scott)"),
  corail,
  harmonographe,
  vitrail,
  constructif,
  reseau: createPlaceholder("reseau", "organique", "Réseau", "vie artificielle (physarum)"),
  hachures,
  pixels,
};

export function techniqueFor(style: StyleId): Technique {
  return TECHNIQUES[style];
}

export const ALL_TECHNIQUES: readonly Technique[] = STYLES.map((s) => TECHNIQUES[s]);
