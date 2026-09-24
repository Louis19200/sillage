# API Sillage

Node 22 + Hono + Postgres (lib `postgres`). Contrat : [docs/API.md](../docs/API.md), types : [`@sillage/shared`](../packages/shared/src/index.ts).

## Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | `postgres://user:mdp@hôte:port/base` |
| `INGEST_TOKEN` | oui | token des routes d'écriture, **32 caractères minimum** (`openssl rand -hex 32`), sinon le démarrage est refusé |
| `PORT` | non (8787) | port d'écoute |
| `ENABLE_JOBS` | non (`false`) | `true` pour lancer les tâches planifiées (`src/jobs.ts`) |
| `GITHUB_TOKEN` | pour la source GitHub | token GitHub personnel **en lecture seule** (voir « Collecteur GitHub ») |
| `GITHUB_LOGIN` | pour la source GitHub | identifiant GitHub dont on lit les contributions |
| `PROTECT_READS` | non | `true` : `/day` et `/range` exigent aussi le token. Défaut : `true` si `NODE_ENV=production`, `false` sinon |

Elles sont lues depuis l'environnement, puis depuis `api/.env` et `.env` à la racine s'ils existent (sans écraser l'environnement).
Attention : la valeur d'exemple de `.env.example` (`change-me-long-random-string`) est trop courte, exprès.

## Démarrer en local

```bash
# 1. Postgres
docker run -d --name sillage-pg -p 5432:5432 -e POSTGRES_USER=sillage -e POSTGRES_PASSWORD=sillage -e POSTGRES_DB=sillage postgres:16
#    (sans Docker : `pnpm --filter api db:pglite` lance un Postgres PGlite en mémoire sur le port 5433)

# 2. Configuration
cp .env.example .env            # à la racine du dépôt
# puis mettre INGEST_TOKEN=$(openssl rand -hex 32) dans .env

# 3. Migrations (idempotent, tracé dans schema_migrations)
pnpm --filter api migrate

# 4. API (rechargement à chaud) ; `pnpm --filter api start` sans rechargement
pnpm --filter api dev
```

## Exemples curl

```bash
export INGEST_TOKEN=...   # la même valeur que dans .env

# Insérer (ou mettre à jour) une journée
curl -X POST localhost:8787/ingest/health \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"days":[{"date":"2026-09-23","steps":8421,"sleep_minutes":412,
       "sleep_start":"2026-09-22T23:48:00+02:00","sleep_end":"2026-09-23T06:40:00+02:00"}]}'
# → {"upserted":1}

# Relire la journée
curl localhost:8787/day/2026-09-23
# → {"date":"2026-09-23","steps":8421,"sleep_minutes":412,"sleep_start":"2026-09-22T21:48:00.000Z",
#    "sleep_end":"2026-09-23T04:40:00.000Z","commits":null,"updated_at":"..."}

# Une plage (bornes incluses, 800 jours max, jours absents non inventés)
curl "localhost:8787/range?from=2026-09-01&to=2026-09-30"

# Effacer une valeur : null ; ne pas y toucher : omettre le champ
curl -X POST localhost:8787/ingest/health \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"days":[{"date":"2026-09-23","sleep_start":null}]}'
```

Si `PROTECT_READS=true`, ajouter `-H "Authorization: Bearer $INGEST_TOKEN"` aux lectures.

Les timestamps (`sleep_start`, `sleep_end`, `updated_at`) sortent en UTC (`Z`) : Postgres ne garde pas le décalage d'origine. Ils ne servent jamais à recalculer `date`.

## Codes de retour

- `200` succès ; `400` corps ou paramètres invalides, avec `{ error, message, issues: [{ path, message }] }` ;
- `401` token absent ou faux ; `404` journée absente ou route inconnue ; `413` corps > 1 Mo ; `500` erreur base.

Chaque appel authentifié à `/ingest/health` écrit une ligne dans `ingest_log` (succès comme échec de validation ou d'écriture). Les `401` ne sont pas journalisés.

## Pour les autres zones

### Base de données (`src/db.ts`)

```ts
import { upsertCommits, logIngest } from "../../db";          // base par défaut (DATABASE_URL)
await upsertCommits([{ date: "2026-09-23", commits: 4 }]);   // n'écrit que `commits`
await logIngest({ source: "github", days_count: 7, first_date: "2026-09-17", last_date: "2026-09-23", ok: true, error: null });
```

Dans les tests, sur PGlite en mémoire :

```ts
import { createTestDb } from "../../../test/helpers";         // PGlite migré
import { setDb } from "../../db";
const { db } = await createTestDb();
setDb(db);            // les fonctions de haut niveau utilisent désormais cette base
await db.upsertCommits(...);   // ou directement via l'objet
```

`date` est toujours une chaîne `YYYY-MM-DD`, en entrée comme en sortie (parser du type `date`, OID 1082, désactivé).

### Tâches planifiées (`src/jobs.ts`)

Ajouter une ligne dans la section « Enregistrements » :
`registerJob("nom", "15 4 * * *", () => maTache(), { timezone: "Europe/Paris" })`.
Elles ne tournent que si `ENABLE_JOBS=true`. Une tâche qui lève une erreur est journalisée, sans arrêter le serveur.

### Routes (`src/app.ts`)

Ajouter une ligne dans la section « Routes des autres zones » de `createApp`.

## Collecteur GitHub (`src/collectors/github/`)

Remplit la colonne `commits` de `daily_metrics` (et rien d'autre) à partir de
`contributionsCollection.contributionCalendar` (API GraphQL de GitHub).

### Créer le token (fine-grained, lecture seule)

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*.
2. *Resource owner* : ton compte ; *Expiration* : au choix (le noter, la synchro échouera en `401` à l'expiration).
3. *Repository access* : **Public repositories (read-only)**. Aucune permission supplémentaire : la requête ne lit que le calendrier de contributions.
   Pour que les dépôts privés comptent : cocher *Include private contributions on my profile* (*Settings* → *Public profile* → *Contributions & activity*) ;
   si les chiffres restent en dessous du calendrier du profil, donner au token *Only select repositories* / *All repositories* avec *Contents: Read-only*.
4. Mettre la valeur dans `GITHUB_TOKEN` (fichier `.env` à la racine, jamais dans le code) et ton identifiant dans `GITHUB_LOGIN`.

Le token n'est jamais écrit dans les logs ni dans `ingest_log` (il est masqué s'il apparaît dans un message d'erreur).

### Commandes

```bash
# Un an d'historique (365 derniers jours, 2 requêtes GraphQL), idempotent
DATABASE_URL=postgres://… pnpm --filter api github:backfill

# Les 7 derniers jours (même chose que la tâche nocturne), idempotent
pnpm --filter api github:sync

# Autre durée
pnpm --filter api exec tsx scripts/backfill-github.ts --days 30
```

Pour remplir la base de production, lancer `github:backfill` en local avec `DATABASE_URL` pointant sur Neon
(migrations déjà appliquées : `pnpm --filter api migrate`). Chaque exécution affiche un résumé JSON et écrit une ligne `source = 'github'` dans `ingest_log`.

### Tâche nocturne `github-sync`

Enregistrée dans `src/jobs.ts` : tous les jours à 04:15 (Europe/Paris), les 7 derniers jours, **une seule requête GraphQL**, sans état en mémoire
(compatible fonction serverless / route cron). Elle renvoie :

```json
{ "source": "github", "from": "2026-09-17T02:15:00.000Z", "to": "2026-09-24T02:15:00.000Z",
  "days_written": 9, "first_date": "2026-09-16", "last_date": "2026-09-24" }
```

### À savoir sur les données

- **Dates** : `contributionDays.date` est calculée par GitHub dans **le fuseau du profil GitHub**. On la reprend telle quelle, sans la recalculer.
  Si le fuseau du profil diffère de celui du téléphone, une contribution faite vers minuit peut tomber sur la journée voisine : c'est accepté.
- **Ce que compte `commits`** : en v1, `contributionCount`, c'est-à-dire **toutes** les contributions (commits, PR, issues, revues),
  pas seulement les commits. `0` quand GitHub dit 0 ; cette source n'écrit jamais `null`.
- **Journées complètes** : GitHub limite une requête à un an ; les plages plus longues sont découpées. Chaque requête démarre 48 h avant
  la plage demandée et sa première journée est écartée (ainsi que la dernière des requêtes intermédiaires, qui se recouvrent de 48 h) :
  on n'écrit jamais une journée coupée par une borne de requête, quel que soit le fuseau du profil. Conséquence : quelques journées
  de plus que demandé sont écrites (9 pour « 7 jours », 367 pour « 365 jours »). La journée en cours est écrite partiellement et
  corrigée par les synchros suivantes.
- **Tout ou rien** : toutes les requêtes sont lues avant d'écrire, puis un seul upsert en transaction. En cas d'erreur, rien n'est écrit,
  une ligne `ok = false` avec le message est ajoutée à `ingest_log`, et l'erreur est propagée (code de sortie 1 pour les scripts).
- **Erreurs** : `401` → token absent, expiré ou révoqué ; `403` → permissions du token, ou limite de requêtes (heure de réinitialisation
  indiquée) ; `429` / `RATE_LIMITED` → limite de requêtes ; login inconnu → « utilisateur GitHub introuvable ».

## Tests

```bash
pnpm --filter api test
```

Vitest + PGlite, aucun Postgres ni Docker nécessaire. `test/postgres-driver.test.ts` passe en plus par le vrai driver `postgres`, branché sur PGlite via `pglite-socket`.
