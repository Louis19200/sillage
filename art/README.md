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
