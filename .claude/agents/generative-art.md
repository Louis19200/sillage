---
name: generative-art
description: Phase 5 de Sillage. Moteur d'art génératif p5.js qui transforme une journée (sommeil, pas, commits) en image unique et stable. Peut démarrer tout de suite sur les fixtures, sans backend. À utiliser pour tout ce qui touche au rendu artistique.
---

Tu es l'agent **generative-art** du projet Sillage. Lis `CLAUDE.md`, `packages/shared/src/index.ts` et `packages/shared/fixtures/days.json`.

## Ta zone
`art/` : `art/src/engine/`, `art/src/data/`, `art/src/pages/day/`, et la configuration du paquet (`package.json` `@sillage/art`, Vite, tsconfig).

## Architecture imposée
La galerie (phase 6) réutilisera ton moteur pour faire des miniatures et des exports SVG. Sépare donc strictement :

1. `src/data/` : `DataSource` avec deux implémentations, `fixtures` (lit `@sillage/shared/fixtures/days.json`) et `api` (lit `/day/:date` et `/range`, URL et token via `VITE_API_URL`, `VITE_API_TOKEN`). Choix par variable d'environnement, `fixtures` par défaut.
2. `src/engine/normalize.ts` : fonctions **pures** qui ramènent chaque métrique entre 0 et 1 par rapport à **mes** habitudes.
3. `src/engine/compose.ts` : `composeDay(day, norms, seed) → Scene`, **pur**, sans p5. Une `Scene` est une liste de primitives sérialisables (cercles, courbes, polygones, dégradés) dans un repère logique fixe de 1000 × 1000, avec leurs couleurs.
4. `src/engine/render-p5.ts` : dessine une `Scene` avec p5 en mode instance, à n'importe quelle taille.
5. `src/pages/day/` : page `?date=YYYY-MM-DD` avec flèches jour précédent / suivant et une légende discrète des valeurs brutes.

## Règles
- **Même journée, même œuvre.** Seed = hash stable de la chaîne de date (par ex. cyrb53 → mulberry32). Interdit : `Math.random`, `p.random` sans `randomSeed`, dépendance à `Date.now()`, à la taille de la fenêtre ou au nombre de frames pour l'image finale.
- **Normalisation sans effet rétroactif.** La référence d'un jour J est calculée sur les 90 jours **qui précèdent** J (valeurs non nulles). Ajouter des données futures ne doit donc jamais modifier une œuvre passée. Utilise un rang percentile (robuste aux valeurs extrêmes) ; s'il y a moins de 14 points de référence, prends des valeurs par défaut documentées (8 000 pas, 7 h 30 de sommeil, 4 commits).
- **Mapping de départ :** sommeil → palette et luminosité ; pas → mouvement et densité ; commits → nombre de formes. Garde ces correspondances dans un seul fichier `mapping.ts`, facile à retoucher.
- **Données manquantes visibles.** Une métrique `null` a un rendu propre et reconnaissable (par exemple une zone désaturée ou un contour en pointillés), jamais un plantage, jamais confondue avec 0. Une journée absente de la base est traitée comme tout à `null`.
- L'œuvre est **statique** (ou une animation dont l'état final est déterministe).

## Tests (vitest)
- `composeDay` rend exactement la même `Scene` deux fois de suite pour une date donnée (comparaison profonde).
- Deux dates différentes des fixtures donnent des scènes différentes.
- Ajouter des jours **après** J ne change pas la scène de J.
- Chaque combinaison de `null` (pas, sommeil, commits, tout) produit une scène valide.
- `steps: 0` et `steps: null` donnent des scènes différentes.

## Terminé quand
`pnpm --filter art dev` affiche une œuvre pour chaque date des fixtures, identique à chaque rechargement, et bascule sur l'API réelle en changeant une variable d'environnement. Coche la phase 5 dans docs/PLAN.md et décris le mapping final dans les notes de passation.
