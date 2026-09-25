/**
 * GABARIT D'UNE TECHNIQUE — à copier en `techniques/<id>.ts` (ex. `pelage.ts`).
 *
 * 1. Copier ce fichier, renommer `modele` et remplir `id`, `family`, `name`, `process`
 *    (l'id et la famille doivent correspondre à `packages/shared/src/selection/constants.ts`).
 * 2. Porter l'esquisse `art/sketches/techniques/<id>.ts` dans `render()` :
 *    - `S` (taille en px) remplace le 1000 des esquisses : tout en fractions de `S` ;
 *    - `input.norms.steps|sleep|commits` (centiles 0–1, **null si absent** : choisir une valeur
 *      neutre ET appeler `drawMissingMark`, jamais « absent = 0 ») remplacent `n.*` ;
 *    - `input.palette` remplace `palette` ; `weatherOrFallback(input.weather)` remplace `weather` ;
 *      `hourlyOrFallback(input)` remplace `hourly` ; `input.moon` remplace `moon` ;
 *    - `rngFor(input, "<id>")` remplace `rngFor("<id>")` ; jamais `Math.random`, ni l'horloge ;
 *    - pas de `document` (le rendu doit pouvoir tourner dans un Worker) : `createCanvas()` ;
 *    - `options.quality === "preview"` (miniatures de galerie) : moins d'itérations, même composition.
 * 3. `explain()` : une ligne par paramètre piloté par une donnée, avec la valeur obtenue.
 *    La fiche de calcul l'affiche sous l'œuvre.
 * 4. Coût : `heavy: true` si le rendu prend plus d'une seconde à 1000 px (Pelage, Réseau) ;
 *    `maxExportSize` borne l'export PNG (mémoire des techniques en pixels).
 * 5. SVG : ajouter `toSvg(input)` seulement si la technique est vectorielle (sinon le bouton
 *    SVG est masqué et la page explique pourquoi).
 * 6. Brancher le module dans `techniques/index.ts` (remplacer `createPlaceholder(...)`),
 *    puis `pnpm --filter @sillage/art test` (déterminisme vérifié pour toutes les techniques).
 *
 * Ce fichier n'est importé nulle part : c'est un modèle, il est seulement vérifié par le typecheck.
 */
import { centile, drawMissingMark, fmt, rngFor } from "../helpers";
import { weatherOrFallback } from "../input";
import type { Technique } from "../types";

export const modele: Technique = {
  id: "pelage", // ← l'id de la technique portée
  family: "organique",
  name: "Modèle",
  process: "procédé en quelques mots",
  ported: true,
  heavy: false,
  maxExportSize: 4000,
  render(ctx, S, input, options = {}) {
    const rng = rngFor(input, "modele");
    const detail = options.quality === "preview" ? 0.25 : 1;
    const energy = input.norms.steps ?? 0.5; // null → neutre (et marque ci-dessous)
    ctx.fillStyle = input.palette.paper;
    ctx.fillRect(0, 0, S, S);
    const count = Math.round((40 + 160 * energy) * detail);
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = input.palette.colors[i % 5]!;
      ctx.beginPath();
      ctx.arc(rng.next() * S, rng.next() * S, S * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }
    drawMissingMark(ctx, S, input, input.palette.ink);
  },
  explain(input) {
    const wind = weatherOrFallback(input.weather).windKmh;
    return [
      { param: "Nombre de points", source: `Pas (${centile(input.norms.steps)})`, value: String(Math.round(40 + 160 * (input.norms.steps ?? 0.5))) },
      { param: "Exemple météo", source: wind.measured ? "Vent mesuré" : "Vent : repli", value: `${fmt(wind.value, 0)} km/h` },
    ];
  },
};
