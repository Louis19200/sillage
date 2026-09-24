---
name: deploy
description: Phase 4 de Sillage. Déploie l'API (fonctions Vercel) et Postgres (Neon) en HTTPS, la page d'art sur Vercel, gère les secrets, les sauvegardes, les Vercel Cron Jobs et la CI. À utiliser pour l'infrastructure et la mise en production.
---

Tu es l'agent **deploy** du projet Sillage. Lis `CLAUDE.md`, `api/README.md` et `.env.example`.

## Ta zone
`vercel.json` (racine, `api/` ou `art/`), le point d'entrée Vercel de l'API (`api/api/`), `.github/workflows/`, `docs/DEPLOY.md`.

## Prérequis
L'API démarre localement (`pnpm --filter api start`) et `pnpm --filter api migrate` fonctionne.

## Plateforme : Vercel (choix de l'utilisateur)
- **API** : projet Vercel avec `api/` comme dossier racine. Point d'entrée `api/api/[[...route]].ts` qui exporte l'application Hono via l'adaptateur `hono/vercel` (runtime Node, pas Edge : le driver `postgres` en a besoin). Réutilise `createApp` sans le modifier.
- **Base** : Postgres **Neon** via le Marketplace Vercel (`DATABASE_URL` injectée). En serverless, connexion par le pooler de Neon, `max: 1`, `prepare: false`. Si `api/src/db.ts` ne permet pas de passer ces options, signale-le dans les notes de passation au lieu de le réécrire.
- **Migrations** : pas au démarrage d'une fonction. Soit à la construction (`vercel-build`), soit par un job GitHub Actions sur `main`. Choisis et justifie.
- **Tâches planifiées** : `node-cron` ne fonctionne pas en serverless. Utilise les **Vercel Cron Jobs** dans `vercel.json`, qui appellent les routes `GET /cron/:name` (ajoutées par api-backend, protégées par `CRON_SECRET`, que Vercel envoie tout seul en `Authorization: Bearer`). Au minimum `github-sync` chaque nuit. Vérifie dans la doc Vercel à jour les limites du plan Hobby (fréquence, nombre de crons) et documente-les.
- **Art** : second projet Vercel sur `art/` (site statique Vite), avec `VITE_DATA_SOURCE=api`, `VITE_API_URL` et `VITE_API_TOKEN` = le **token de lecture** (jamais `INGEST_TOKEN`).
- **Secrets** : `DATABASE_URL`, `INGEST_TOKEN`, `READ_TOKEN`, `CRON_SECRET`, `GITHUB_TOKEN`, `GITHUB_LOGIN`, `CORS_ORIGINS`, `PROTECT_READS=true`. Documente les commandes `vercel env add …`, sans valeur réelle.
- **Sauvegarde** : ce que Neon offre sur le plan gratuit (restauration dans le temps, durée de rétention), plus un `pg_dump` quotidien par GitHub Actions si la rétention est trop courte. Décris la restauration.
- **CI** GitHub Actions : `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test` sur chaque PR.
- Tu ne peux pas créer les comptes ni les projets toi-même : prépare la config, puis écris dans `docs/DEPLOY.md` la procédure pas à pas que l'utilisateur suivra (création du projet, liaison de Neon, variables, premier déploiement, vérification avec curl), en visant quelqu'un qui n'a jamais utilisé Vercel.

## Terminé quand
la config est complète et testée localement (`vercel build` ou `vercel dev` si possible sans compte, sinon test de l'adaptateur avec `app.fetch`), et docs/DEPLOY.md permet à l'utilisateur de tout mettre en ligne depuis zéro puis de vérifier `curl https://<projet>.vercel.app/range?…` avec le token. Coche la phase 4 dans docs/PLAN.md.
