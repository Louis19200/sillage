/**
 * Marée : l'œuvre v1 telle quelle (`composeDay` du moteur v1), dessinée par le rendu canvas
 * sans p5. Elle garde sa propre palette (celle de la v1, pilotée par le sommeil) pour que
 * « Marée » soit exactement l'œuvre v1 du même jour. Vectorielle : export SVG possible.
 */
import { composeDay } from "../../engine/compose";
import { derivedParams } from "../../engine/mapping";
import { createRng } from "../../engine/random";
import { drawSceneToContext } from "../../engine/render-canvas";
import type { Scene } from "../../engine/scene";
import { sceneToSvg } from "../../export/svg";
import { centile, fmtInt } from "../helpers";
import type { Technique, TechniqueInput } from "../types";

export function mareeScene(input: TechniqueInput): Scene {
  return composeDay(input.day, input.v1Norms, input.seed);
}

const MODE: Record<string, string> = { night: "nocturne (sous mon habitude)", day: "diurne (au-dessus de mon habitude)", mist: "brume (sommeil non mesuré)" };
const FLOW: Record<string, string> = { moving: "courant", still: "eau dormante (0 pas)", unknown: "sillages en pointillés (pas non mesurés)" };

export const maree: Technique = {
  id: "maree",
  family: "organique",
  name: "Marée",
  process: "bruit et champ de flux (œuvre v1)",
  ported: true,
  heavy: false,
  ownPalette: true,
  maxExportSize: 8000,
  toSvg: (input) => sceneToSvg(mareeScene(input)),
  render(ctx, size, input) {
    drawSceneToContext(ctx, mareeScene(input), size);
  },
  explain(input) {
    // Même tirage que composeDay : createRng(seed) puis derivedParams.
    const p = derivedParams(input.day, input.v1Norms, createRng(input.seed));
    const n = input.norms;
    return [
      { param: "Palette et luminosité (palette v1)", source: `Sommeil (${centile(n.sleep)})`, value: MODE[p.palette.mode] ?? p.palette.mode },
      { param: "Taille de l'astre", source: `Sommeil (${centile(n.sleep)})`, value: `rayon ${fmtInt(p.orb.r)} / 1000` },
      { param: "Hauteur de l'astre", source: "Heure du réveil", value: input.day.sleep_end ? `y = ${fmtInt(p.orb.cy)} / 1000` : "position par défaut (réveil inconnu)" },
      { param: "Nombre de sillages (densité)", source: `Pas (${centile(n.steps)})`, value: `${p.flow.lines} lignes · ${FLOW[p.flow.state]}` },
      { param: "Amplitude des remous (mouvement)", source: `Pas (${centile(n.steps)})`, value: p.flow.turbulence.toFixed(2).replace(".", ",") },
      {
        param: "Pierres",
        source: input.day.commits === null ? "Commits non mesurés" : `Commits (${input.day.commits}, ${centile(n.commits)})`,
        value: p.stones.state === "unknown" ? `${p.stones.count} pierres fantômes en pointillés` : `${p.stones.count} pierre${p.stones.count > 1 ? "s" : ""}, rayon ${fmtInt(p.stones.radius)}`,
      },
    ];
  },
};
