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
| `render-p5.ts` | dessine une `Scene` avec p5 (mode instance) ou sur n'importe quel contexte 2D |
| `geometry.ts` | Catmull-Rom → Bézier, partagé par les rendus (canvas aujourd'hui, SVG demain) |
| `index.ts` | API publique (sans p5) + `composeForDate(date, history)` |

Aperçus : [`docs/previews/`](docs/previews/).

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
