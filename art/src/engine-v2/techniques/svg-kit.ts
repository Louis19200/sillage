/**
 * Petits outils SVG des techniques vectorielles du moteur v2 (Corail, Harmonographe) :
 * repère logique 1000 × 1000, nombres arrondis de façon stable, et la même marque « données
 * manquantes » que `drawMissingMark` (cadre en pointillés + un tiret par métrique absente).
 * Pur, sans DOM.
 */
import { missingMetrics } from "../helpers";
import type { TechniqueInput } from "../types";

/** 1 décimale au plus (repère 1000 : un dixième de pixel), jamais « -0 ». */
export function n1(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? "0" : String(r);
}

export function svgOpen(background: string, title: string): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">`,
    `<title>${title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</title>`,
    `<rect width="1000" height="1000" fill="${background}"/>`,
  ];
}

/** Équivalent SVG de `drawMissingMark` (mêmes cotes, en unités logiques). */
export function svgMissingMark(input: TechniqueInput, color: string): string {
  const missing = missingMetrics(input);
  if (missing.length === 0) return "";
  const dashes = missing.map((_, i) => `M${960 - i * 22} 964H${972 - i * 22}`).join("");
  return (
    `<g stroke="${color}" stroke-opacity="0.55" fill="none">` +
    `<rect x="22" y="22" width="956" height="956" stroke-width="1.6" stroke-dasharray="6 7"/>` +
    `<path d="${dashes}" stroke-width="3"/></g>`
  );
}
