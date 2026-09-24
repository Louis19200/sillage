# Contrat de l'API

Source de vérité des types : [`packages/shared/src/index.ts`](../packages/shared/src/index.ts).
Schéma SQL : [`api/db/migrations/001_daily_metrics.sql`](../api/db/migrations/001_daily_metrics.sql).

## Règles non négociables

1. **Dates locales, résolues par le client.** `date` est toujours une chaîne `YYYY-MM-DD` calculée en heure locale sur le téléphone. Le serveur ne dérive **jamais** une date d'un timestamp.
2. **`null` ≠ `0`.** `null` = pas de donnée. `0` = vraiment zéro. Aucune valeur par défaut à 0, nulle part.
3. **Upsert systématique.** Renvoyer la même journée met à jour la ligne, sans jamais la dupliquer. Un champ **omis** ne modifie pas la colonne ; un champ à **`null`** l'efface.
4. **Sommeil = jour du réveil.** La nuit du 23 au 24 est comptée pour le 24.
5. **Chaque source n'écrit que ses colonnes.** `/ingest/health` ne touche jamais `commits` ; le collecteur GitHub ne touche que `commits`.

## Authentification

En-tête `Authorization: Bearer <token>`, comparaison en temps constant, `401` sinon.

| Routes | Tokens acceptés |
|---|---|
| Écriture (`POST /ingest/*`) | `INGEST_TOKEN` **uniquement** |
| Lecture (`GET /day/:date`, `GET /range`) | aucun si `PROTECT_READS=false` ; sinon `READ_TOKEN` **ou** `INGEST_TOKEN` |
| Tâches (`GET /cron/:name`) | `CRON_SECRET` uniquement |

- `PROTECT_READS` : défaut `true` si `NODE_ENV=production` (les données sont personnelles), `false` en local.
- `READ_TOKEN` (facultatif, 32 caractères minimum, différent d'`INGEST_TOKEN`) : token de **lecture seule** destiné à la page d'art, dont le bundle client est public. Il ne permet jamais d'écrire.

## CORS

`CORS_ORIGINS` : liste d'origines complètes séparées par des virgules (`https://sillage-art.vercel.app,http://localhost:5173`), sans joker. Vide : aucun en-tête CORS.
S'applique **uniquement** à `GET /day/:date` et `GET /range` : `Access-Control-Allow-Origin` = l'origine si elle est dans la liste (absent sinon), méthodes `GET, OPTIONS`, en-têtes `Authorization, Content-Type`, `Max-Age` 600 s. Le preflight `OPTIONS` répond `204` sans token. Les routes d'écriture et `/cron` n'envoient jamais d'en-tête CORS.

## Endpoints

### `POST /ingest/health` 🔒
Corps : `HealthIngestBody` = `{ "days": HealthDay[] }` (1 à 400 jours).
Réponse `200` : `{ "upserted": number }`. `400` avec le détail zod si le corps est invalide.

```bash
curl -X POST localhost:8787/ingest/health \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"days":[{"date":"2026-09-23","steps":8421,"sleep_minutes":412,
       "sleep_start":"2026-09-22T23:48:00+02:00","sleep_end":"2026-09-23T06:40:00+02:00"}]}'
```

### `GET /day/:date`
Réponse `200` : `DailyMetrics`. `404` si la journée n'existe pas. `400` si la date est invalide.

### `GET /range?from=YYYY-MM-DD&to=YYYY-MM-DD`
Bornes incluses, `from <= to`, au plus `MAX_RANGE_DAYS` jours.
Réponse `200` : `RangeResponse` (seuls les jours présents en base, triés). Les jours absents ne sont **pas** inventés : c'est au client de les traiter comme manquants.

### `GET /cron/:name` 🔒 `CRON_SECRET`
Exécute la tâche enregistrée sous `name` dans le registre de `api/src/jobs.ts` (`registerJob`). C'est ainsi que les **Vercel Cron Jobs** déclenchent les tâches (ils envoient `Authorization: Bearer <CRON_SECRET>` d'eux-mêmes) ; node-cron (`ENABLE_JOBS`) ne sert qu'en local. L'horaire vit dans `vercel.json`, pas dans l'expression passée à `registerJob`.

- `200` : `{ "job": string, "ok": true, "duration_ms": number, "result": <valeur renvoyée par la tâche, ou null> }`
- `500` : `{ "job": string, "ok": false, "duration_ms": number, "error": string }` si la tâche lève
- `401` secret absent ou faux (vérifié avant l'existence de la tâche) ; `404` tâche inconnue ; `503` si `CRON_SECRET` n'est pas défini.
- Réponses en `Cache-Control: no-store`.

```bash
curl localhost:8787/cron/github-sync -H "Authorization: Bearer $CRON_SECRET"
```

### `GET /health` (phase 7)
`200 { "status": "ok", "db": "ok", "last_ingest": { "health": iso|null, "github": iso|null } }`, `503` si la base est injoignable.

## Timestamps en sortie

`sleep_start`, `sleep_end`, `updated_at` sont renvoyés en ISO 8601 avec décalage. Postgres les stocke en UTC : c'est acceptable car ils ne servent **jamais** à recalculer `date`.
