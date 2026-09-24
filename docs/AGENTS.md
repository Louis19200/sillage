# Découpage du projet en agents IA

Sept agents spécialisés (plus un gabarit pour les extensions), chacun propriétaire d'une zone du dépôt.
Les fiches se trouvent dans [`.claude/agents/`](../.claude/agents/) : Claude Code les charge comme sous-agents, et n'importe quel autre outil (Cursor, Codex, Aider…) peut les lire comme un prompt.

| Agent | Phase | Fiche |
|---|---|---|
| `api-backend` | 1 | [api-backend.md](../.claude/agents/api-backend.md) |
| `github-collector` | 2 | [github-collector.md](../.claude/agents/github-collector.md) |
| `android-app` | 3 | [android-app.md](../.claude/agents/android-app.md) |
| `deploy` | 4 | [deploy.md](../.claude/agents/deploy.md) |
| `generative-art` | 5 | [generative-art.md](../.claude/agents/generative-art.md) |
| `gallery` | 6 | [gallery.md](../.claude/agents/gallery.md) |
| `ops-reliability` | 7 | [ops-reliability.md](../.claude/agents/ops-reliability.md) |
| `extensions` | 8 | [extensions.md](../.claude/agents/extensions.md) |

## Ce qui permet de travailler en parallèle

Les contrats sont **déjà écrits** dans ce dépôt, donc aucun agent n'attend le code d'un autre pour démarrer :

- `packages/shared/src/index.ts` : types et schémas zod (`DailyMetrics`, `HealthIngestBody`, `RangeResponse`…).
- `api/db/migrations/001_daily_metrics.sql` : le schéma de la base.
- `docs/API.md` : les routes, codes de retour et règles de données.
- `packages/shared/fixtures/days.json` : 120 journées factices (avec trous et zéros) pour développer l'art sans backend.

## Ordre de lancement

```
Vague 0 (toi)     Phase 0 : vérifier Health Connect, créer les tokens
                     │
Vague 1           api-backend ──────┐     generative-art (sur fixtures)     android-app étapes 1-3 (hors ligne)
(en parallèle)                      │
Vague 2           github-collector ◄┘     deploy ◄── api-backend             android-app étapes 4-5 (sync)
(en parallèle)
Vague 3           gallery ◄── generative-art     ops-reliability ◄── api-backend + deploy     android-app étape 6
Vague 4           extensions (une source par exécution)
```

Dépendances réelles :
- `github-collector` réutilise le module base de données de `api-backend`.
- `deploy` a besoin d'une API qui démarre.
- `gallery` réutilise le moteur de rendu de `generative-art`.
- `ops-reliability` a besoin de l'API et de la plateforme choisie par `deploy`.
- `android-app` peut coder la synchro dès la vague 1 contre le contrat ; elle la **valide** contre une API qui tourne en vague 2.

## Propriété des fichiers

| Zone | Propriétaire | Les autres peuvent… |
|---|---|---|
| `packages/shared/` | personne seul (contrat) | proposer un changement, voir plus bas |
| `api/` (hors sous-dossiers ci-dessous) | `api-backend` | ajouter **une ligne** dans `api/src/jobs.ts` ou `api/src/app.ts` pour enregistrer leur job ou leur route |
| `api/src/collectors/github/`, `api/scripts/backfill-github.ts` | `github-collector` | |
| `api/src/ops/` | `ops-reliability` | |
| `api/src/collectors/<source>/` | `extensions` | |
| `app/` | `android-app` | |
| `art/src/engine/`, `art/src/data/`, `art/src/pages/day/` | `generative-art` | `gallery` peut **appeler** le moteur, pas le modifier |
| `art/src/pages/gallery/`, `art/src/export/`, `art/scripts/` | `gallery` | |
| `Dockerfile`, `fly.toml` / `railway.json`, `.github/workflows/`, `docs/DEPLOY.md` | `deploy` | `ops-reliability` ajoute ses jobs de surveillance |

## Changer un contrat

Si un agent a besoin de modifier `packages/shared`, `docs/API.md` ou une migration déjà appliquée :
1. Changement **additif** seulement (nouveau champ optionnel, nouvelle route, nouvelle migration `00N_…sql`). On ne renomme ni ne supprime.
2. Même commit : le schéma zod, `docs/API.md`, les fixtures si besoin, et les tests de `packages/shared`.
3. Le signaler dans « Notes de passation » de docs/PLAN.md pour que les autres agents le voient.

## Lancer un agent

**Avec Claude Code**, depuis la racine du dépôt :
```
> Utilise l'agent api-backend pour réaliser la phase 1.
```
ou en parallèle :
```
> Lance en parallèle api-backend, generative-art et android-app (étapes 1 à 3 seulement), chacun sur sa propre branche.
```

**Avec un autre outil**, colle le contenu de CLAUDE.md puis celui de la fiche de l'agent comme instruction initiale.

Conseil : une branche par agent (`agent/api-backend`, …), fusion dans `main` quand le critère « Terminé quand » de la phase est atteint.
