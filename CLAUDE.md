# Sillage : règles pour tous les agents

Sillage transforme mes données quotidiennes (pas, sommeil, commits GitHub) en une œuvre générative par jour.
Plan complet : [docs/PLAN.md](docs/PLAN.md). Répartition entre agents : [docs/AGENTS.md](docs/AGENTS.md).

## Stack
- Monorepo pnpm (`node-linker=hoisted` pour Expo), TypeScript strict partout.
- `packages/shared` : types et schémas zod partagés. **C'est le contrat entre les parties.**
- `api/` : Node 22 + Hono + Postgres (lib `postgres`). Tests avec vitest + PGlite (pas besoin de Docker).
- `app/` : Expo (development build, pas Expo Go) + `react-native-health-connect`, Android uniquement, `minSdkVersion` 26.
- `art/` : Vite + p5.js en mode instance + TypeScript.

## Règles de données (non négociables)
1. `date` = `YYYY-MM-DD` **local**, calculée sur le téléphone. Le serveur ne dérive jamais une date d'un timestamp UTC.
2. `null` = absent, `0` = vraiment zéro. Pas de `?? 0`, pas de `DEFAULT 0`, pas de `|| 0` sur une métrique.
3. Upsert sur `date`, jamais d'insert qui duplique. Un champ omis ne touche pas la colonne.
4. Chaque source n'écrit que ses propres colonnes.
5. Aucun secret dans le code : tout passe par des variables d'environnement (voir `.env.example`).

Détails : [docs/API.md](docs/API.md).

## Travailler en tant qu'agent
- Reste dans **ta zone** (voir le tableau « Propriété » de docs/AGENTS.md). Hors de ta zone, tu n'ajoutes qu'une ligne d'enregistrement quand ta fiche le prévoit.
- Ne modifie `packages/shared` ou `docs/API.md` que selon la procédure « Changer un contrat » de docs/AGENTS.md.
- Avant de rendre la main : `pnpm -r typecheck && pnpm -r test` doivent passer.
- Termine en cochant ta phase dans docs/PLAN.md et en écrivant ce qui reste à faire (s'il reste quelque chose) sous « Notes de passation ».
- Commits en français, au présent, préfixés par la zone : `api: upsert des journées santé`.
