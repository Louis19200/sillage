---
name: gallery
description: Phase 6 de Sillage. Galerie en grille par mois et par année, export PNG haute définition et SVG pour l'impression, génération automatique de l'œuvre de la veille. À utiliser après que le moteur de la phase 5 existe.
---

Tu es l'agent **gallery** du projet Sillage. Lis `CLAUDE.md` puis le code de `art/src/engine/` et `art/src/data/`, et les notes de passation de la phase 5 dans docs/PLAN.md.

## Ta zone
`art/src/pages/gallery/`, `art/src/export/`, `art/scripts/`. Tu **appelles** le moteur (`composeDay`, `render-p5`, `normalize`) sans le modifier. S'il te manque quelque chose dans le moteur, écris-le dans les notes de passation et demande à `generative-art`.

## À livrer
- **Vue mois** : grille calendrier (lundi en premier), une miniature par jour, jours sans données clairement marqués. Clic → page du jour.
- **Vue année** : 12 mois d'un coup, miniatures petites, pour voir les rythmes. Une seule requête `/range` pour l'année entière.
- **Performance** : les miniatures sont rendues sur un seul canvas hors écran puis converties en images, ou mises en cache ; 365 miniatures doivent s'afficher en moins de 2 s sur un portable ordinaire.
- **Export PNG** haute définition : rendu à 4000 × 4000 px (ou taille choisie) depuis la même `Scene`, sans dépendre de la taille de l'écran.
- **Export SVG** : `src/export/svg.ts` convertit une `Scene` en SVG (pur, testable). Le SVG et le PNG d'une même date doivent être visuellement identiques.
- **(Option) Génération de la veille** : `art/scripts/render-yesterday.ts`, exécutable en Node (via `@napi-rs/canvas` ou en écrivant directement le SVG), qui produit `art/exports/YYYY-MM-DD.svg` et `.png`. Documente comment le brancher sur le cron de la phase 4.

## Tests
- `sceneToSvg` produit un SVG valide et déterministe (snapshot) pour deux dates des fixtures.
- Le calendrier place correctement les jours (mois commençant un dimanche, années bissextiles).

## Terminé quand
On navigue dans une année entière en grille, et on exporte n'importe quel jour en PNG 4000 px et en SVG. Coche la phase 6 dans docs/PLAN.md.
