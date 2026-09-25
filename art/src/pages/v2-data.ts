/**
 * Données d'une vue v2 (page du jour, galerie) : une seule requête qui couvre la période,
 * ses 90 jours de référence et une marge pour retrouver deux jours figés consécutifs.
 *
 * Sans aucun style figé (fixtures, ou API avant son premier gel), la chaîne doit partir de
 * l'origine : la source fixtures connaît son premier jour et on charge depuis lui, pour que
 * la page du jour et la galerie donnent le même style. Avec l'API, les styles figés suffisent.
 */
import type { DataSource } from "../data";
import { addDays } from "../engine";
import { selectStyles, type DaySelection, type DayWithStyle } from "../engine-v2";

/** Marge chargée avant la période (90 jours de référence + 30 de reprise). */
export const V2_WINDOW_DAYS = 120;

export interface V2Data {
  days: DayWithStyle[];
  origin: string | undefined;
  selections: Map<string, DaySelection>;
}

export async function loadV2(source: DataSource, from: string, to: string): Promise<V2Data> {
  const windowFrom = addDays(from, -V2_WINDOW_DAYS);
  const first = source.firstDate ? await source.firstDate() : null;
  const start = first && first < windowFrom ? first : windowFrom;
  const days = (await source.getRange(start, to)) as DayWithStyle[];
  const origin = first ?? import.meta.env.VITE_SELECTION_ORIGIN;
  return { days, origin, selections: selectStyles(days, from, to, { origin }) };
}
