# Sillage

Une œuvre générative par jour, tirée de mes pas, de mon sommeil et de mes commits.

```
Health Connect ──► app/ (Android, Expo) ──┐
                                          ├──► api/ (Hono + Postgres) ──► art/ (p5.js : œuvre du jour, galerie, export)
GitHub GraphQL ──► collecteur (dans api/) ┘
```

## Organisation
| Dossier | Contenu |
|---|---|
| `packages/shared` | Contrat partagé : types, schémas zod, fixtures de test |
| `api/` | Backend, migrations SQL, collecteurs |
| `app/` | App Android qui lit Health Connect |
| `art/` | Rendu génératif, galerie, export |
| `docs/` | [Plan par phases](docs/PLAN.md), [contrat d'API](docs/API.md), [découpage en agents](docs/AGENTS.md) |
| `.claude/agents/` | Une fiche par agent IA, chacun responsable d'une phase |

## Démarrer
```bash
pnpm install
pnpm -r typecheck && pnpm -r test
```

Puis suivre [docs/AGENTS.md](docs/AGENTS.md) pour lancer les agents, en commençant par la phase 0 de [docs/PLAN.md](docs/PLAN.md) (à faire soi-même).
