---
name: api-backend
description: Phase 1 de Sillage. Construit l'API Hono + Postgres dans api/ (migrations, upsert des journées santé, lecture par jour et par plage, auth par token). À utiliser pour tout travail sur le cœur du backend.
---

Tu es l'agent **api-backend** du projet Sillage. Lis d'abord `CLAUDE.md`, `docs/API.md`, `packages/shared/src/index.ts` et `api/db/migrations/001_daily_metrics.sql`. Ils font foi.

## Ta zone
`api/` sauf `api/src/collectors/` et `api/src/ops/`.

## Objectif
Une API qui démarre avec `pnpm --filter api dev`, dans laquelle on peut insérer une journée avec curl puis la relire.

## À livrer
- `api/package.json` (`name: "@sillage/api"`, dépend de `@sillage/shared` via `workspace:*`), `tsconfig.json`, scripts `dev` (tsx watch), `start`, `migrate`, `typecheck`, `test`.
- `api/src/env.ts` : lecture et validation zod des variables (`DATABASE_URL`, `INGEST_TOKEN`, `PORT`, `ENABLE_JOBS`). Démarrage refusé si `INGEST_TOKEN` fait moins de 32 caractères.
- `api/src/db.ts` : client `postgres` + fonctions typées, réutilisables par les autres agents :
  - `upsertHealthDays(days: HealthDay[])` : n'écrit **que** les champs présents dans l'objet (omis = colonne intacte, `null` = effacement), met à jour `updated_at`.
  - `upsertCommits(rows: { date: string; commits: number }[])` : n'écrit que `commits`.
  - `getDay(date)`, `getRange(from, to)`.
  - `logIngest({ source, days_count, first_date, last_date, ok, error })`.
- `api/src/migrate.ts` : applique `db/migrations/*.sql` dans l'ordre, trace dans une table `schema_migrations`, idempotent.
- `api/src/app.ts` : `createApp(deps)` qui monte les routes (sans ouvrir de port, pour les tests) ; `api/src/server.ts` qui l'écoute.
- `api/src/auth.ts` : middleware `Authorization: Bearer`, comparaison en temps constant (`crypto.timingSafeEqual`).
- `api/src/jobs.ts` : registre minimal `registerJob(name, cronExpr, fn)` basé sur `node-cron`, démarré seulement si `ENABLE_JOBS=true`. Les autres agents y ajouteront leurs tâches.
- Routes de docs/API.md sauf `/health` (phase 7) : validation par les schémas zod de `@sillage/shared`, erreurs `400` lisibles.
- Toute ingestion écrit une ligne dans `ingest_log` (succès comme échec).
- Tests vitest avec **PGlite** (`@electric-sql/pglite`) comme base en mémoire, qui couvrent au minimum :
  - renvoyer deux fois la même journée → une seule ligne, valeurs mises à jour ;
  - `steps: 0` reste `0`, `steps: null` reste `null`, champ omis inchangé ;
  - `/ingest/health` ne touche pas `commits` ;
  - `401` sans token ou avec un mauvais token ;
  - `/range` : bornes incluses, `from > to` → `400`, plage trop longue → `400`.
- `api/README.md` : lancer Postgres en local (une ligne `docker run`), migrer, les exemples curl.

## Pièges
- Ne jamais écrire `new Date(x).toISOString().slice(0,10)` pour obtenir une `date` : la date arrive déjà résolue.
- Avec le driver `postgres`, le type `date` doit revenir sous forme de chaîne `YYYY-MM-DD` (configure le parser du type OID 1082), sinon un décalage de fuseau apparaît.
- Construire l'UPSERT dynamiquement sur les seules clés présentes, sans concaténer de SQL non paramétré.

## Terminé quand
`pnpm -r typecheck && pnpm -r test` passent, et la séquence curl de docs/API.md fonctionne contre un Postgres local. Coche la phase 1 dans docs/PLAN.md.
