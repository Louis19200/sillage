# Déploiement de Sillage : Vercel + Neon

Ce document permet de tout mettre en ligne **depuis zéro**, sans avoir jamais utilisé Vercel.
Compter une heure la première fois. Coût : **0 €** (Vercel Hobby + Neon Free + GitHub Actions).

```
 Téléphone Android ──POST /ingest/health (INGEST_TOKEN)──┐
                                                         ▼
 Vercel Cron (1×/jour) ──GET /cron/github-sync──►  Projet Vercel « sillage-api »  ──►  Neon Postgres
                          (CRON_SECRET)            (fonction Node 22, dossier api/)     (Free, Francfort)
                                                         ▲                                   │
 Navigateur ──► Projet Vercel « sillage-art » ──GET /range (READ_TOKEN)                      │
                (site statique Vite, dossier art/)                                           │
                                                                                             ▼
 GitHub Actions : CI sur chaque PR ; pg_dump chiffré chaque nuit ◄───────────────────────────┘
```

## Pourquoi ce montage

- **Vercel** (choix de l'utilisateur) : HTTPS automatique avec redirection du HTTP, déploiement à chaque push sur `main`, plan Hobby gratuit. Deux projets dans le même dépôt : `api/` (fonction) et `art/` (statique).
- **Neon** via le Marketplace Vercel : Postgres géré, gratuit, variables injectées toutes seules. Mise en veille après 5 min d'inactivité (premier appel un peu plus lent), ce qui convient à un usage perso.
- **Tâches planifiées** : `node-cron` ne tourne pas en serverless ; ce sont les **Vercel Cron Jobs** (`api/vercel.json`) qui appellent `GET /cron/github-sync`. Une seule source de planification, donc pas de double exécution.
- **Migrations au build Vercel** plutôt que dans GitHub Actions : elles passent **avant** que le nouveau code soit servi, un échec annule le déploiement (l'ancienne version reste en ligne), et la chaîne de connexion reste chez Vercel. Seulement en production.
- **Sauvegarde** : la restauration dans le temps de Neon ne couvre que 6 h sur le plan gratuit, d'où un `pg_dump` chiffré quotidien gardé 30 jours dans GitHub Actions.

---

## 0. Ce qu'il faut avant de commencer

- Le dépôt poussé sur GitHub (branche `main`).
- Sur ton poste : Node 22, pnpm **10.33** (la version fixée par le dépôt ; sous Windows, si `pnpm` échoue avec « …\\.tools\\pnpm\\… n'est pas reconnu », lance-le via `npx pnpm@10.33.0 …`), `openssl` (sous Windows, voir l'encadré de la section 1), et pour la restauration `psql`/`pg_restore` (Postgres ≥ la version de Neon) et `gpg`.
- La CLI Vercel (facultative mais pratique) : `npm i -g vercel`, puis `vercel login`.
- La CLI GitHub `gh` (facultative) pour poser les secrets des sauvegardes.

## 1. Générer les secrets (une fois, sur ton poste)

Range chaque valeur dans ton gestionnaire de mots de passe : Vercel les masque ensuite.

> **Windows (PowerShell), sans openssl.** Même générateur cryptographique, même format :
> ```powershell
> # équivalent de « openssl rand -hex 32 » (64 caractères hexadécimaux)
> $b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
> # équivalent de « openssl rand -base64 32 »
> $b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
> ```
> Ou, avec Node (installé de toute façon pour pnpm) : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

| Nom | Commande | Sert à |
|---|---|---|
| `INGEST_TOKEN` | `openssl rand -hex 32` | écriture (`POST /ingest/health`) : l'app Android. **Jamais** dans le navigateur. |
| `READ_TOKEN` | `openssl rand -hex 32` | lecture seule (`/day`, `/range`) : la page d'art. Finit dans le JavaScript public de la page. |
| `CRON_SECRET` | `openssl rand -hex 32` | Vercel l'envoie en `Authorization: Bearer …` à chaque cron ; la route `/cron/:name` le vérifie. |
| `GITHUB_TOKEN` | github.com → Settings → Developer settings → Fine-grained tokens → *Generate* : aucun dépôt, aucune permission (ou « Contents : read » sur tes dépôts privés pour qu'ils comptent). Expiration : 1 an, à noter dans ton agenda. | collecteur GitHub |
| `GITHUB_LOGIN` | ton identifiant GitHub | collecteur GitHub |
| `BACKUP_PASSPHRASE` | `openssl rand -base64 32` | chiffrement des sauvegardes. **Sans elle, les sauvegardes sont illisibles** : garde-la hors de GitHub. |

## 2. Projet Vercel de l'API

### 2.1 Créer le projet

1. Crée un compte sur vercel.com (« Continue with GitHub »), plan **Hobby**.
2. **Add New… → Project**, choisis le dépôt `sillage` (*Adjust GitHub App Permissions* s'il n'apparaît pas).
3. Écran « Configure Project » :
   - **Project Name** : `sillage-api` (l'URL sera `https://sillage-api.vercel.app`, ou un suffixe si le nom est pris : note l'URL réelle).
   - **Root Directory** : *Edit* → `api`.
   - **Framework Preset** : `Other`. Ne touche pas aux commandes : `api/vercel.json` les fixe (`buildCommand: node api/_build.mjs`).
   - **Environment Variables** : ajoute tout de suite ceux de la section 2.3 que tu as déjà (tout sauf ceux de Neon).
4. **Deploy**. Ce premier déploiement **échoue**, c'est normal : le build veut appliquer les migrations et il n'y a pas encore de base (`[sillage build] migrations demandées mais ni DATABASE_URL_UNPOOLED ni DATABASE_URL n'est défini`).
5. **Settings → Build and Deployment** : *Node.js Version* = **22.x** ; vérifie que *Include files outside the root directory in the Build Step* est **activé** (l'API importe `packages/shared`).

### 2.2 Créer et lier la base Neon

1. Dans le projet `sillage-api` : onglet **Storage → Create Database → Neon** (Serverless Postgres) → *Continue*.
2. Région : **Europe Central 1 (Frankfurt)** ; plan : **Free** ; nom : `sillage`.
3. *Connect Project* : `sillage-api`, environnements **Production** et **Development**. Laisse **Preview** décoché (sinon voir « Migrations » plus bas).
4. Vercel ajoute seul `DATABASE_URL` (connexion **poolée**, pour la fonction), `DATABASE_URL_UNPOOLED` (connexion **directe**, pour les migrations et `pg_dump`) et des variantes `PG*` / `POSTGRES_*` inutilisées.
5. **Settings → Functions → Function Region** : **Frankfurt (fra1)**, pour que la fonction soit à côté de la base.

### 2.3 Variables d'environnement

**Settings → Environment Variables**, environnement **Production** (cocher aussi *Sensitive*).

| Variable | Valeur | Remarque |
|---|---|---|
| `DATABASE_URL` | posée par Neon | poolée |
| `DATABASE_URL_UNPOOLED` | posée par Neon | utilisée par les migrations au build |
| `DATABASE_SERVERLESS` | `true` | driver en mode pooler Neon : `max: 1`, `prepare: false` |
| `INGEST_TOKEN` | section 1 | ≥ 32 caractères, sinon l'API refuse de répondre |
| `READ_TOKEN` | section 1 | |
| `CRON_SECRET` | section 1 | |
| `GITHUB_TOKEN` | section 1 | |
| `GITHUB_LOGIN` | section 1 | |
| `PROTECT_READS` | `true` | lectures protégées par token (données personnelles) |
| `CORS_ORIGINS` | `https://sillage-art.vercel.app` | l'URL exacte du projet art (section 5), sans `/` final ; plusieurs : séparées par des virgules |
| `ENABLE_JOBS` | **ne pas définir** | `node-cron` n'a rien à faire en serverless ; les crons passent par Vercel |

Avec la CLI, depuis `api/` (le premier `vercel link` demande le projet : choisis `sillage-api`) :

```bash
cd api
vercel link
# Chaque commande demande la valeur (collée, rien n'est affiché ni gardé dans l'historique) :
vercel env add INGEST_TOKEN production --sensitive
vercel env add READ_TOKEN production --sensitive
vercel env add CRON_SECRET production --sensitive
vercel env add GITHUB_TOKEN production --sensitive
vercel env add GITHUB_LOGIN production
vercel env add DATABASE_SERVERLESS production --value true --yes
vercel env add PROTECT_READS production --value true --yes
vercel env add CORS_ORIGINS production --value https://sillage-art.vercel.app --yes
vercel env ls production
```

> **Une variable modifiée ne s'applique qu'aux déploiements suivants.** Après tout changement : *Deployments → ⋯ → Redeploy*.

### 2.4 Premier vrai déploiement

*Deployments* → le déploiement en échec → **⋯ → Redeploy** (ou pousse un commit sur `main`). Dans les *Build Logs*, tu dois voir :

```
[sillage build] migrations (connexion directe)…
migration appliquée : 001_daily_metrics.sql
[sillage build] fonction regroupée : .vercel/output/functions/index.func/index.mjs
```

Ensuite, chaque push sur `main` redéploie la production ; chaque autre branche donne un déploiement *Preview* (sans migration).

### 2.5 Vérifier l'API

Depuis la racine du dépôt, sur ton poste (Windows, macOS ou Linux). Mets d'abord dans le `.env` à la racine l'URL de l'API et les mêmes secrets que sur Vercel :

```
API_URL=https://sillage-api.vercel.app
INGEST_TOKEN=...
READ_TOKEN=...
CRON_SECRET=...
```

Puis, depuis la racine du dépôt :

```
node api/scripts/check-prod.mjs
```

Le script n'a besoin que de Node 22 ou plus, sans `pnpm install` (`pnpm --filter api check:prod` fait la même chose si pnpm fonctionne chez toi).

La commande vérifie la redirection HTTP → HTTPS, le refus sans token, chaque token (lecture, écriture, cron) et affiche combien de journées la base contient sur les 30 derniers jours. **Elle n'écrit rien** : l'écriture est testée avec un corps volontairement invalide (400 attendu), et le cron avec une tâche inexistante (404 attendu). En cas d'échec, chaque ligne dit quoi corriger.

Rappel : après avoir ajouté ou modifié une variable sur Vercel, il faut **redéployer** (*Deployments → ⋯ → Redeploy*) pour qu'elle soit prise en compte.

<details><summary>À la main, dans PowerShell</summary>

Dans PowerShell, `curl` n'est pas le vrai curl : utilise `Invoke-RestMethod`.

```powershell
$API = "https://sillage-api.vercel.app"
$READ = "colle-ici-READ_TOKEN"
Invoke-RestMethod "$API/range?from=2026-09-01&to=2026-09-30" -Headers @{ Authorization = "Bearer $READ" }
```
</details>

## 3. Cron GitHub

`api/vercel.json` déclare :

```json
"crons": [{ "path": "/cron/github-sync", "schedule": "15 2 * * *" }]
```

- Expressions en **UTC** : 02:15 UTC = 04:15 à Paris l'été, 03:15 l'hiver.
- **Limites du plan Hobby** (doc Vercel « Usage & Pricing for Cron Jobs », septembre 2026) : **au plus une exécution par jour et par cron** (une expression plus fréquente fait échouer le déploiement) ; **précision à l'heure** : `15 2 * * *` part n'importe quand entre 02:00 et 02:59 ; jusqu'à 100 crons par projet. Les crons ne tournent que sur le déploiement de **production**, sans nouvel essai en cas d'échec. Pro : précision à la minute.
- La synchro relit les 7 derniers jours et fait un upsert : un jour de retard ou une double livraison (possible chez Vercel) ne créent ni trou ni doublon.
- Vercel envoie `Authorization: Bearer $CRON_SECRET` tout seul si la variable existe. Sans elle (ou si elle a été ajoutée sans redéployer), la route répond 401.
- Vérifier : *Settings → Cron Jobs* liste `/cron/github-sync` ; le bouton **Run** le lance tout de suite ; les journaux sont dans *Logs*. À la main :
  ```bash
  curl -s "$API/cron/github-sync" -H "Authorization: Bearer $CRON_SECRET"
  ```
- Ajouter une tâche : l'enregistrer dans `api/src/jobs.ts` (nom), puis une ligne `{ "path": "/cron/<nom>", "schedule": "…" }` dans `api/vercel.json`.

## 4. Remplir l'historique GitHub depuis ton poste

Le cron ne remonte que 7 jours ; l'année écoulée se remplit une fois, en local, directement sur Neon :

```bash
# Chaîne DIRECTE : Vercel → Storage → sillage → onglet « .env.local » → DATABASE_URL_UNPOOLED
# (ou console Neon → Connect → décocher « Connection pooling »)
export DATABASE_URL='postgresql://…-direct…/neondb?sslmode=require'
export GITHUB_TOKEN=…  GITHUB_LOGIN=…
pnpm install
pnpm --filter api github:backfill
unset DATABASE_URL GITHUB_TOKEN
```

Ne laisse pas la chaîne de production dans `api/.env` ou `.env` après coup (ils sont ignorés par git, mais l'API locale s'y connecterait).
Vérifie : `curl -s "$API/range?from=2025-10-01&to=2026-09-30" -H "Authorization: Bearer $READ_TOKEN" | head -c 400`.

## 5. Projet Vercel de la page d'art

1. **Add New… → Project**, le **même** dépôt, **Project Name** `sillage-art`, **Root Directory** `art`. Le preset **Vite** est fixé par `art/vercel.json` (`pnpm build` → `dist/`).
2. Variables (Production), lues **au build** par Vite :

   | Variable | Valeur |
   |---|---|
   | `VITE_DATA_SOURCE` | `api` |
   | `VITE_API_URL` | `https://sillage-api.vercel.app` (sans `/` final) |
   | `VITE_API_TOKEN` | le **`READ_TOKEN`**, jamais `INGEST_TOKEN` : il est lisible par quiconque ouvre la page |

   ```bash
   cd art && vercel link        # choisis sillage-art
   vercel env add VITE_DATA_SOURCE production --value api --yes
   vercel env add VITE_API_URL production --value https://sillage-api.vercel.app --yes
   vercel env add VITE_API_TOKEN production --sensitive
   ```
3. **Deploy**, puis note l'URL (`https://sillage-art.vercel.app`) et mets-la dans `CORS_ORIGINS` du projet API, puis **Redeploy** l'API.
4. Ouvre `https://sillage-art.vercel.app/?date=2026-09-23`. Une erreur CORS dans la console du navigateur = `CORS_ORIGINS` ne correspond pas exactement à l'origine de la page.
5. « Impossible de charger la journée : Failed to fetch » = le navigateur a été bloqué, presque toujours par le CORS. Ajoute `ART_URL=<adresse exacte de la page>` dans ton `.env` et lance `node api/scripts/check-prod.mjs` : il dit quelle valeur mettre dans `CORS_ORIGINS`. Attention, chaque déploiement Vercel a aussi sa propre adresse (`sillage-art-<hash>-….vercel.app`) : n'utilise que l'adresse de production (*Settings → Domains*), c'est elle qu'il faut autoriser.

Facultatif : dans chaque projet, *Settings → Build and Deployment*, active l'option qui saute les déploiements quand ni le dossier racine ni ses dépendances n'ont changé (monorepo), pour qu'un commit dans `app/` ne reconstruise rien. À défaut, *Ignored Build Step* : `git diff --quiet HEAD^ HEAD -- . ../packages/shared ../pnpm-lock.yaml`.

## 6. App Android

Dans l'écran de réglages de l'app (phase 3, étape 4) :

- **URL de l'API** : `https://sillage-api.vercel.app` (HTTPS obligatoire, sans `/` final) ;
- **Token** : `INGEST_TOKEN` (gardé dans SecureStore sur le téléphone).

Appuie sur « Synchroniser », puis vérifie que les 7 derniers jours sont arrivés :
`curl -s "$API/range?from=<J-7>&to=<J-1>" -H "Authorization: Bearer $READ_TOKEN"`.

## 7. Migrations

- Appliquées par `api/api/_build.mjs` au build Vercel, **avant** la mise en ligne du nouveau code, uniquement si `VERCEL_ENV=production`. Connexion directe (`DATABASE_URL_UNPOOLED`), sinon `DATABASE_URL`.
- Une migration en échec fait échouer le build : l'ancienne version reste servie. Les migrations étant **additives** (docs/AGENTS.md), l'ancien code fonctionne avec le nouveau schéma.
- `SILLAGE_MIGRATE=1` force (par ex. dans l'environnement *Preview* si tu lies Neon aux previews : l'intégration crée alors une branche de base par preview), `SILLAGE_MIGRATE=0` désactive.
- À la main : `DATABASE_URL='<chaîne directe>' pnpm --filter api migrate` (idempotent).

## 8. Sauvegardes et restauration

### Ce que Neon offre (plan Free, septembre 2026)

- **Restauration dans le temps** sur une fenêtre de **6 heures** (historique limité à 1 Go de changements), plus **1 instantané manuel**. Console Neon → *Branches* → `main` → **Restore** : choisis un horodatage, Neon remet la branche dans cet état en quelques secondes (l'état remplacé reste disponible comme branche de secours).
- C'est trop court pour une erreur remarquée le lendemain, d'où la sauvegarde ci-dessous.

### Sauvegarde quotidienne (GitHub Actions)

`.github/workflows/backup.yml`, chaque nuit à 03:40 UTC : `pg_dump` au format *custom* (image officielle `postgres:<PG_MAJOR>`), vérification que `daily_metrics` y est, chiffrement **gpg AES-256** avec `BACKUP_PASSPHRASE`, puis artefact `sillage-AAAA-MM-JJ.dump.gpg` gardé **30 jours**.

Mise en place (une fois) :

```bash
# Chaîne DIRECTE (DATABASE_URL_UNPOOLED), pas la poolée
gh secret set BACKUP_DATABASE_URL        # colle la chaîne
gh secret set BACKUP_PASSPHRASE          # colle la phrase de la section 1
# Version majeure de Postgres chez Neon (console Neon → Settings, ou : psql "$URL" -c 'show server_version')
gh variable set PG_MAJOR --body 17
```

(ou GitHub → *Settings → Secrets and variables → Actions*). Puis **Actions → Sauvegarde de la base → Run workflow** une première fois et vérifie qu'un artefact apparaît. Un échec (secret manquant, base injoignable, `pg_dump` trop ancien) rend le run rouge et GitHub t'envoie un e-mail.

### Restaurer une sauvegarde

Procédure testée le 2026-09-24 sur un Postgres 16 local (dump → chiffrement → déchiffrement → restauration dans une base vide, puis par-dessus une base modifiée : données, `schema_migrations` et `ingest_log` retrouvés).

```bash
# 1. Récupérer l'artefact (ou : Actions → le run → Artifacts → télécharger et dézipper)
gh run list --workflow backup.yml --limit 5
gh run download <run-id> --name sillage-2026-09-24.dump.gpg

# 2. Déchiffrer (demande BACKUP_PASSPHRASE)
gpg --output sillage.dump --decrypt sillage-2026-09-24.dump.gpg

# 3. Restaurer d'abord dans une base neuve pour vérifier :
#    console Neon → Branches → Create branch (vide ou depuis main) → copier sa chaîne directe
export TARGET='postgresql://…/neondb?sslmode=require'
pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname="$TARGET" sillage.dump

# 4. Contrôler
psql "$TARGET" -c "select count(*), min(date), max(date) from daily_metrics" -c "select name from schema_migrations"

# 5. Remettre en production : soit refaire l'étape 3 avec la chaîne directe de la branche main,
#    soit faire de la branche restaurée la branche par défaut dans Neon.
rm sillage.dump
```

`--clean --if-exists` remplace les tables existantes ; `--single-transaction` garantit tout ou rien. `pg_restore` doit être d'une version ≥ celle du dump (`psql --version`).

## 9. CI

`.github/workflows/ci.yml`, sur chaque pull request et chaque push sur `main` : `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r --workspace-concurrency=1 test`, puis `pnpm --filter @sillage/api vercel:check` (construit la fonction comme Vercel, avec migrations sur un Postgres PGlite, et rejoue les appels curl contre le fichier produit). Le déploiement, lui, est fait par l'intégration Git de Vercel.

Pour exiger une CI verte avant fusion : GitHub → *Settings → Branches → Add rule* sur `main` → *Require status checks* → `typecheck + tests`.

## 10. Comment la fonction est construite (pour les curieux et le dépannage)

| Fichier | Rôle |
|---|---|
| `api/vercel.json` | preset « Other », `buildCommand`, crons |
| `api/api/_build.mjs` | migrations, bundle esbuild, sortie Build Output API v3 (`.vercel/output/`) |
| `api/api/_handler.ts` | gestionnaire Node `(req, res)` exporté par défaut (`getRequestListener` de `@hono/node-server`) |
| `api/api/_app.ts` | construit l'app avec `createApp` (comme `src/server.ts`, sans port ni `node-cron`) à la première requête |
| `api/api/_smoke.ts` | essai de bout en bout local (`pnpm --filter @sillage/api vercel:check`) |
| `art/vercel.json` | preset Vite, en-têtes `noindex` / `nosniff` |

Pourquoi pas le déploiement « zéro configuration » de Hono ou un simple `api/[[...route]].ts` : le builder Node de Vercel transpile les fichiers **un par un** sans les regrouper. Or l'API importe ses modules sans extension (`./db`) et `@sillage/shared` est publié en TypeScript : la fonction plantait au chargement (`Cannot find module …/src/app`, constaté avec `vercel build` 60.0.0). Le bundle esbuild règle les deux. Les fichiers de `api/api/` commencent par `_` pour que Vercel ne les prenne pas pour des fonctions.

La route unique de `config.json` envoie toutes les URL à la fonction (`/(.*)` → `/index?__path=/$1`) ; `_app.ts` remet le chemin d'origine, que la plateforme transmette l'URL d'origine ou l'URL réécrite.

Construire localement comme Vercel, sans compte :

```bash
cd api
SILLAGE_MIGRATE=0 node api/_build.mjs             # bundle seul
npx vercel build --prod                             # si le projet est lié (vercel link)
```

## 11. Dépannage

| Symptôme | Cause probable |
|---|---|
| Build : `migrations demandées mais ni DATABASE_URL_UNPOOLED ni DATABASE_URL…` | base Neon pas liée à l'environnement Production (2.2) |
| Build : `échec des migrations` | base injoignable ou SQL en erreur : lire la ligne au-dessus |
| Build : erreur pnpm / lockfile | ajouter la variable `ENABLE_EXPERIMENTAL_COREPACK=1` (Vercel utilise alors pnpm 10.33 de `packageManager`) |
| `500 {"error":"misconfigured"}` | variable manquante ou invalide : le détail est dans *Logs* (ex. `INGEST_TOKEN` < 32 caractères) |
| `401` | mauvais token, ou variable ajoutée sans redéployer |
| Erreur CORS dans le navigateur | `CORS_ORIGINS` ≠ origine exacte de la page d'art |
| Cron en 401 | `CRON_SECRET` absent du déploiement de production |
| Premier appel lent (1–2 s) | réveil de Neon (veille après 5 min) et démarrage à froid de la fonction : normal |

## Tout refaire depuis zéro : la liste

1. Secrets générés (section 1).
2. Projet `sillage-api`, racine `api`, Node 22 (2.1).
3. Neon Free à Francfort lié en Production + Development, région de fonction `fra1` (2.2).
4. Variables de l'API (2.3), redéploiement, migrations visibles dans les logs (2.4).
5. Vérifications curl (2.5).
6. Cron visible dans *Settings → Cron Jobs*, lancé une fois avec *Run* (3).
7. Backfill GitHub depuis le poste (4).
8. Projet `sillage-art`, racine `art`, variables Vite, puis `CORS_ORIGINS` de l'API et redéploiement (5).
9. App Android configurée avec l'URL et `INGEST_TOKEN`, synchro vérifiée (6).
10. Secrets `BACKUP_*` + variable `PG_MAJOR`, sauvegarde lancée une fois à la main (8).
