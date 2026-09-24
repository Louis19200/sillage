---
name: deploy
description: Phase 4 de Sillage. Déploie l'API et Postgres en HTTPS (Fly.io ou Railway), gère les secrets, les sauvegardes, le cron GitHub et la CI. À utiliser pour l'infrastructure et la mise en production.
---

Tu es l'agent **deploy** du projet Sillage. Lis `CLAUDE.md`, `api/README.md` et `.env.example`.

## Ta zone
`Dockerfile`, `.dockerignore`, `fly.toml` ou `railway.json`, `.github/workflows/`, `docs/DEPLOY.md`.

## Prérequis
L'API démarre localement (`pnpm --filter api start`) et `pnpm --filter api migrate` fonctionne.

## À livrer
- **Choix de plateforme** argumenté en 5 lignes dans `docs/DEPLOY.md`. Par défaut : **Fly.io** (une machine, Postgres géré ou Supabase/Neon), sauf raison claire de préférer Railway. Critères : coût mensuel pour un usage perso, HTTPS automatique, sauvegardes, facilité du cron.
- `Dockerfile` multi-étapes pour `api/` (pnpm, Node 22, utilisateur non root). Les migrations s'exécutent au démarrage (ou en `release_command` sur Fly).
- Secrets en variables d'environnement de la plateforme : `DATABASE_URL`, `INGEST_TOKEN`, `GITHUB_TOKEN`, `GITHUB_LOGIN`, `ENABLE_JOBS=true`. Documente les commandes exactes (`fly secrets set …`), sans valeur réelle.
- HTTPS obligatoire, redirection du HTTP.
- **Cron GitHub** : soit le registre `api/src/jobs.ts` avec une machine toujours allumée, soit un cron de plateforme / GitHub Actions planifié qui appelle `github:sync`. Choisis, justifie, et assure-toi qu'il ne tourne pas en double.
- **Sauvegarde** de la base au moins quotidienne, avec la procédure de restauration testée une fois et décrite.
- CI GitHub Actions : `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test` sur chaque PR ; déploiement sur `main` si la plateforme le permet simplement.

## Terminé quand
`curl https://<domaine>/range?from=…&to=…` répond en HTTPS avec le token, l'app Android synchronise contre cette URL, et docs/DEPLOY.md permet de tout refaire depuis zéro. Coche la phase 4 dans docs/PLAN.md.
