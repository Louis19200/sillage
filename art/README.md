# art/

Rendu génératif p5.js. Zones des agents `generative-art` (phase 5) et `gallery` (phase 6) : voir `.claude/agents/`.

```bash
pnpm --filter @sillage/art dev      # http://localhost:5173/?date=2026-07-14
pnpm --filter @sillage/art test
```

Source des données (voir `.env.example`) : `VITE_DATA_SOURCE=fixtures` (défaut) ou
`VITE_DATA_SOURCE=api` avec `VITE_API_URL` et `VITE_API_TOKEN`.

## Moteur (`src/engine/`)

| Fichier | Rôle |
|---|---|
| `normalize.ts` | métriques → 0–1 par rang percentile sur les 90 jours **avant** J (défauts sous 14 points) |
| `mapping.ts` | **le** fichier à retoucher : données → palette, astre, courant, pierres |
| `compose.ts` | `composeDay(day, norms, seed) → Scene`, pur, sans p5 |
| `scene.ts` | types de la `Scene` (JSON pur, repère 1000 × 1000) |
| `render-canvas.ts` | dessine une `Scene` sur n'importe quel contexte 2D, sans p5 (Worker compris) |
| `render-p5.ts` | monte une `Scene` avec p5 (mode instance) ; réexporte `drawSceneToContext` |
| `geometry.ts` | Catmull-Rom → Bézier, partagé par les rendus (canvas aujourd'hui, SVG demain) |
| `index.ts` | API publique (sans p5) + `composeForDate(date, history)` |

Aperçus : [`docs/previews/`](docs/previews/).

## Moteur v2 (`src/engine-v2/`)

Chaque jour est rendu par **une technique parmi 10**, choisie de façon déterministe. La v1 reste
intacte : sélecteur « v1 · v2 » sur la page du jour et dans la galerie (`?engine=v1|v2`, mémorisé ;
v2 par défaut pour une première visite).

| Fichier | Rôle |
|---|---|
| `packages/shared/src/selection/constants.ts` | **le** fichier des réglages du choix : styles, familles, formule de K, tranches, poids, ajustements, exclusions |
| `packages/shared/src/selection/select.ts` | `selectDay`, `computeChain` : le même calcul pour le navigateur et l'API (qui fige les styles) |
| `select.ts` | style figé renvoyé par l'API, sinon calcul local (`selectStyles`) |
| `input.ts` | `buildTechniqueInput(date, history, style)` : journée, centiles, graine, palette, météo / pas horaires (ou `FALLBACKS`), lune |
| `palette.ts` | palettes v2 : saison (durée du jour), humeur (sommeil), nuance (température si connue) |
| `techniques/` | une technique par fichier ; `index.ts` est le registre ; `placeholder.ts` le rendu provisoire |
| `render.ts`, `render.worker.ts` | rendu dans un pool de Workers (OffscreenCanvas), repli sur le fil principal |
| `fiche.ts` | modèle de la fiche « Comment cette œuvre a été choisie » (la page en fait du HTML : `pages/day/fiche-view.ts`) |

Portées : **Marée** (l'œuvre v1, SVG possible) et **Attracteur**. Les huit autres ont un rendu
provisoire (cercles aux couleurs du jour, nom de la technique) en attendant leur module.

```bash
pnpm --filter @sillage/art v2:styles                 # style de chaque jour des fixtures + fréquences
pnpm --filter @sillage/art v2:styles -- range.json   # idem sur un export de GET /range
pnpm --filter @sillage/art exec vite --port 5231 --strictPort &
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @sillage/art capture:v2   # déterminisme + captures docs/previews/v2/
```

### Ajouter une technique

1. Copier `src/engine-v2/techniques/_template.ts` en `techniques/<id>.ts` (id de `STYLES`, ex. `pelage`).
2. Porter l'esquisse `sketches/techniques/<id>.ts` dans `render(ctx, S, input, options)` : tout en fractions
   de `S` ; `input.norms.*` (centiles, **`null` si absent** → valeur neutre + `drawMissingMark`) ;
   `input.palette` ; `weatherOrFallback(input.weather)`, `hourlyOrFallback(input)`, `input.moon` ;
   `rngFor(input, "<id>")` ; jamais `Math.random`, l'horloge ni `document` (`createCanvas()` à la place) ;
   `options.quality === "preview"` → moins d'itérations pour les miniatures.
3. `explain(input)` : une ligne par paramètre piloté par une donnée (paramètre, donnée, valeur).
4. `heavy: true` si > 1 s à 1000 px (il tourne déjà dans un Worker) ; `maxExportSize` ; `toSvg` seulement si vectoriel.
5. Dans `techniques/index.ts`, remplacer `createPlaceholder(...)` par le module.
6. `pnpm --filter @sillage/art test` puis `capture:v2` (vérifie que l'image est identique d'un rendu à l'autre).

Déterminisme : même journée, même entrée, même image dans un navigateur donné. L'Attracteur étant
chaotique, deux moteurs JavaScript dont `Math.sin` diffère au dernier bit peuvent dessiner des
détails différents de la même forme. Le style choisi, lui, est figé par l'API au bout de 3 jours.

## Galerie et exports (phase 6)

| Page / fichier | Rôle |
|---|---|
| `/gallery/?year=2025` | douze mois d'un coup ; choix de l'année (`VITE_GALLERY_FIRST_YEAR`, défaut 2019 → aujourd'hui) |
| `/gallery/?month=2025-10` | calendrier du mois (lundi en premier) ; `←` `→` au clavier |
| `src/pages/gallery/` | `calendar.ts` (grilles pures), `inputs.ts` (données, empreintes), `thumbs.ts` (miniatures), `compose.worker.ts`, `cache.ts` (IndexedDB) |
| `src/export/svg.ts` | `sceneToSvg(scene, { size?, metadata? })`, pur et déterministe |
| `src/export/png.ts` | `sceneToPngBlob(scene, 4000)` : rendu du moteur sur un canvas détaché, 300 dpi (`png-dpi.ts`) |
| `src/export/controls.ts` | boutons « Exporter PNG [4000 px] · SVG » de la page du jour |
| `scripts/render-yesterday.ts` | œuvre de la veille en Node → `art/exports/YYYY-MM-DD.{svg,png}` |

Une case vide marquée d'un point = journée absente de la base ou sans aucune métrique (0 compte comme une donnée).
Chaque vue fait **une** requête `/range` (la période + les 90 jours de référence avant son premier jour).

**Miniatures** : composition dans un pool de Web Workers (`hardwareConcurrency − 1`, 6 au plus, 2 travaux en file
chacun), dessin par `drawSceneToContext` sur un seul canvas hors écran par tranches de 12 ms, `toBlob` (WebP) →
`<img>`. Cache IndexedDB par (taille, date), valide tant que la version du build et l'empreinte des entrées
(J + ses 90 jours) n'ont pas changé. En dev, le cache est coupé (`?cache` pour l'activer) ; `?nocache` et
`?workers=N` servent aux mesures. `window.__gallery.stats` donne les chiffres de la dernière vue.

```bash
pnpm --filter @sillage/art render:yesterday                          # fixtures, veille locale
pnpm --filter @sillage/art render:yesterday --date 2026-07-14 --size 2000 --out /tmp/sillage
TZ=Europe/Paris SILLAGE_API_URL=https://… SILLAGE_READ_TOKEN=… pnpm --filter @sillage/art render:yesterday
```

Sortie 3 = la journée n'a aucune donnée (rien n'est écrit, `--allow-empty` pour la brume) : le téléphone n'a
pas encore synchronisé, relancer plus tard. Le PNG est rastérisé par resvg **depuis le SVG** : même image.

**Chaque matin (à brancher)** : Vercel Cron ne convient pas (pas de disque durable). Un workflow GitHub Actions
planifié le fait simplement, par exemple `.github/workflows/render-yesterday.yml` :

```yaml
on:
  schedule: [{ cron: "45 5 * * *" }]   # 07:45 Paris l'été, 06:45 l'hiver (UTC)
  workflow_dispatch:
jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @sillage/art render:yesterday
        env:
          TZ: Europe/Paris
          SILLAGE_API_URL: ${{ secrets.SILLAGE_API_URL }}
          SILLAGE_READ_TOKEN: ${{ secrets.SILLAGE_READ_TOKEN }}
      - uses: actions/upload-artifact@v4
        with: { name: sillage-exports, path: art/exports/, retention-days: 90 }
```
