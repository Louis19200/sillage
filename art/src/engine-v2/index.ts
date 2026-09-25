/**
 * Moteur v2 : une technique parmi 10 par jour, choisie par `@sillage/shared` (sélection),
 * dessinée par `techniques/`. Aucun import de p5 : utilisable dans un Worker.
 *
 *   const sel = selectStyles(days, date, date).get(date)!;
 *   const input = buildTechniqueInput(date, days, sel.style);
 *   await renderDirect(ctx, 1000, input);         // ou createRenderer().bitmap(input, 1000)
 *   const fiche = buildFiche(sel, techniqueFor(sel.style), input);
 */
export const ENGINE_VERSION = "v2";
export * from "./types";
export { buildTechniqueInput, FALLBACKS, hourlyOrFallback, weatherOrFallback, weatherOf, type DayV2 } from "./input";
export { paletteFor, explainPalette, dayLengthHours, moonPhase, seasonOf, moodOf, SEASONS, MOODS } from "./palette";
export { TECHNIQUES, ALL_TECHNIQUES, techniqueFor } from "./techniques";
export { selectStyles, resolveOrigin, toSelectionDay, type DaySelection, type DayWithStyle } from "./select";
export { buildFiche, compactFiche, type FicheModel, type ChanceBar, type FicheRow } from "./fiche";
