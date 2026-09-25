/**
 * Registre des 10 techniques, toutes portées. `placeholder.ts` (rendu provisoire) reste disponible
 * pour une future technique : l'enregistrer ici avec `createPlaceholder(...)` en attendant son module
 * (voir `_template.ts`).
 */
import { STYLES, type StyleId } from "@sillage/shared";
import type { Technique } from "../types";
import { attracteur } from "./attracteur";
import { constructif } from "./constructif";
import { corail } from "./corail";
import { harmonographe } from "./harmonographe";
import { maree } from "./maree";
import { hachures } from "./hachures";
import { pelage } from "./pelage";
import { pixels } from "./pixels";
import { reseau } from "./reseau";
import { vitrail } from "./vitrail";

export const TECHNIQUES: Record<StyleId, Technique> = {
  maree,
  attracteur,
  pelage,
  corail,
  harmonographe,
  vitrail,
  constructif,
  reseau,
  hachures,
  pixels,
};

export function techniqueFor(style: StyleId): Technique {
  return TECHNIQUES[style];
}

export const ALL_TECHNIQUES: readonly Technique[] = STYLES.map((s) => TECHNIQUES[s]);
