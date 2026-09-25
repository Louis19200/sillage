# Contrat de l'API

Source de vérité des types : [`packages/shared/src/index.ts`](../packages/shared/src/index.ts).
Schéma SQL : [`api/db/migrations/001_daily_metrics.sql`](../api/db/migrations/001_daily_metrics.sql), contexte de la journée : [`004_weather_location.sql`](../api/db/migrations/004_weather_location.sql) (types : [`packages/shared/src/context.ts`](../packages/shared/src/context.ts)).

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

### `POST /ingest/location` 🔒 (phase 8)
Position quotidienne envoyée par le téléphone. Corps : `LocationIngestBody` = `{ "days": LocationDay[] }` (1 à 400 jours), `LocationDay` = `{ "date": "YYYY-MM-DD", "lat": number, "lon": number }` (date locale résolue sur le téléphone ; `lat` ∈ [-90, 90], `lon` ∈ [-180, 180] ; tout autre champ est refusé).
Le serveur **arrondit à 2 décimales** (~1 km) avant d'écrire et ne stocke jamais plus précis (colonnes `numeric(…, 2)`). Upsert sur `date` : renvoyer une journée remplace sa position. Aucune coordonnée dans `ingest_log` (source `location`) ni dans les journaux.
Réponse `200` : `{ "upserted": number }`. `400` avec `issues` (chemins et messages, jamais les valeurs reçues). `401` sans `INGEST_TOKEN` (le `READ_TOKEN` ne suffit pas).

```bash
curl -X POST localhost:8787/ingest/location \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"days":[{"date":"2026-09-23","lat":48.8566,"lon":2.3522}]}'
```

### `GET /day/:date`
Réponse `200` : `DailyMetrics` + `context` (voir « Contexte de la journée »). `404` si la journée n'existe pas. `400` si la date est invalide.

### `GET /range?from=YYYY-MM-DD&to=YYYY-MM-DD`
Bornes incluses, `from <= to`, au plus `MAX_RANGE_DAYS` jours.
Réponse `200` : `RangeResponse` (seuls les jours présents en base, triés), chaque journée avec son `context`. Les jours absents ne sont **pas** inventés : c'est au client de les traiter comme manquants.

### Contexte de la journée : champ `context` (phase 8)
`GET /day/:date` et `GET /range` ajoutent à chaque journée un champ **`context`** : un objet `DayContext`, ou `null` si rien n'est encore stocké pour ce jour. Champ additif : un client qui l'ignore (schéma `DailyMetrics`) continue de fonctionner ; schémas complets : `DailyMetricsWithContext`, `RangeWithContextResponse`. Il n'apparaît que sur les réponses `200`.

```jsonc
"context": {
  "location_source": "home",      // "phone" | "home" | null : provenance de la position utilisée
  "temp_min": 12.3, "temp_max": 24.6,  // °C, au dixième
  "precip_mm": 0,                 // cumul, mm (0 = vraiment sec)
  "wind_max_kmh": 10.1,           // vent max à 10 m
  "wind_dir_deg": 101,            // direction dominante (d'où vient le vent), 0–360
  "cloud_mean": 12,               // couverture nuageuse moyenne, %
  "sunshine_min": 669,            // ensoleillement, minutes
  "sunrise": "07:39", "sunset": "19:52",  // heure locale du lieu, HH:MM
  "weather_code": 1,              // code météo WMO 0–99
  "kp_max": 2.333,                // Kp maximal de la journée locale (0–9, par tiers)
  "updated_at": "2026-09-25T02:45:12.000Z"
}
```
- Chaque valeur peut être `null` (source pas encore synchronisée, archive en retard, tranche Kp non publiée) ; `null` n'est jamais `0`.
- **Les coordonnées ne sont jamais renvoyées en lecture** (le `READ_TOKEN` finit dans le bundle public de la page d'art) : seule `location_source` l'est.
- Météo : Open-Meteo, agrégée sur le jour local **du lieu** (`timezone=auto`) ; position du jour envoyée par le téléphone, sinon « maison » (`HOME_LAT` / `HOME_LON`).
- Kp : GFZ Potsdam, maximum des tranches de 3 h qui recouvrent la journée locale dans `CONTEXT_TZ` (défaut `Europe/Paris`), écrit seulement quand toutes ces tranches sont publiées.
- Phase de lune : pas stockée ; `moonPhase(date)` de `@sillage/shared` (`{ phase, illumination, age_days, waxing }`, évaluée à 12:00 UTC).

### Moteur v2 : `style` et `style_explain` (ajout additif)
Pour une journée dont le style est **figé** (table `artworks`, tâche `freeze-styles`), `GET /day/:date` et chaque jour de `GET /range` portent en plus :
- `style` : l'une des 10 techniques (`StyleIdSchema` : `maree`, `attracteur`, `pelage`, `corail`, `harmonographe`, `vitrail`, `constructif`, `reseau`, `hachures`, `pixels`) ;
- `style_explain` : le calcul complet qui l'a choisi (`SelectionExplain` de `packages/shared/src/selection/select.ts` : valeurs brutes, K, u, centiles, tranche, ajustements, exclusions, chances, point de tirage) + `frozen_at` (ISO) et `engine_version` (`"v2"`).

Les jours non figés (les 3 derniers, ou avant le premier gel) n'ont **pas** ces champs : le client calcule alors le style lui-même avec la même fonction (`computeChain` de `@sillage/shared`). Un jour figé ne change plus jamais, même si ses données changent. Si la lecture de `artworks` échoue, les routes répondent quand même, sans ces champs.

La tâche `freeze-styles` (`GET /cron/freeze-styles`, 03:30 UTC) calcule la chaîne depuis le premier jour de `daily_metrics` et fige chaque jour (données ou pas) qui a au moins 3 jours (« aujourd'hui » à Paris) et ne l'est pas encore. Idempotente. Résultat : `{ today, cutoff, origin, selection_version, frozen, first, last, already_frozen }`.

### `GET /cron/:name` 🔒 `CRON_SECRET`
Exécute la tâche enregistrée sous `name` dans le registre de `api/src/jobs.ts` (`registerJob`). C'est ainsi que les **Vercel Cron Jobs** déclenchent les tâches (ils envoient `Authorization: Bearer <CRON_SECRET>` d'eux-mêmes) ; node-cron (`ENABLE_JOBS`) ne sert qu'en local. L'horaire vit dans `vercel.json`, pas dans l'expression passée à `registerJob`.

- `200` : `{ "job": string, "ok": true, "duration_ms": number, "result": <valeur renvoyée par la tâche, ou null> }`
- `500` : `{ "job": string, "ok": false, "duration_ms": number, "error": string }` si la tâche lève
- `401` secret absent ou faux (vérifié avant l'existence de la tâche) ; `404` tâche inconnue ; `503` si `CRON_SECRET` n'est pas défini.
- Réponses en `Cache-Control: no-store`.

```bash
curl localhost:8787/cron/github-sync -H "Authorization: Bearer $CRON_SECRET"
```

Tâche `context-sync` (phase 8) : météo et Kp des 7 dernières journées complètes (hier et avant, dans `CONTEXT_TZ`), plus au plus 60 journées dont la position du téléphone est arrivée après le calcul de leur météo. `result` = `{ from, to, weather: { source, days_requested, days_written, days_empty, requests, first_date, last_date }, kp: { source, days_requested, days_written, first_date, last_date } }` ; `500` si la météo ou le Kp échoue (l'autre est quand même écrit).

### `GET /health` (phase 7)
`200 { "status": "ok", "db": "ok", "last_ingest": { "health": iso|null, "github": iso|null } }`, `503` si la base est injoignable.

## Timestamps en sortie

`sleep_start`, `sleep_end`, `updated_at` sont renvoyés en ISO 8601 avec décalage. Postgres les stocke en UTC : c'est acceptable car ils ne servent **jamais** à recalculer `date`.
