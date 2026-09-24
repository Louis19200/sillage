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

Routes d'écriture : en-tête `Authorization: Bearer <INGEST_TOKEN>`. Comparaison en temps constant. `401` sinon.
Routes de lecture : publiques en local. En production, même token ou lecture publique selon le choix fait en phase 4 (les données sont personnelles : **token par défaut**).

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

### `GET /health` (phase 7)
`200 { "status": "ok", "db": "ok", "last_ingest": { "health": iso|null, "github": iso|null } }`, `503` si la base est injoignable.

## Timestamps en sortie

`sleep_start`, `sleep_end`, `updated_at` sont renvoyés en ISO 8601 avec décalage. Postgres les stocke en UTC : c'est acceptable car ils ne servent **jamais** à recalculer `date`.
