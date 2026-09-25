# Source : contexte de la journée (météo, position, Kp, lune)

## Cadrage
1. **Origine** : météo d'[Open-Meteo](https://open-meteo.com) (gratuit, sans clé) ; position envoyée par le téléphone (`POST /ingest/location`), sinon position « maison » (`HOME_LAT` / `HOME_LON`) ; indice Kp du [GFZ Potsdam](https://kp.gfz.de) (définitif depuis 1932, provisoire en quasi temps réel) ; phase de lune calculée (`moonPhase` dans `@sillage/shared`), jamais stockée.
2. **Granularité** : une ligne par journée locale dans `daily_context` (migration `004_weather_location.sql`), clé `date`.
3. **Journée locale, météo** : Open-Meteo agrège sur le jour local **du lieu** (`timezone=auto`) et renvoie ses propres dates, reprises telles quelles. Min/max de température, cumul de pluie, vent max et direction dominante, nébulosité moyenne, ensoleillement, lever/coucher (heure locale du lieu), code WMO.
4. **Journée locale, Kp** : maximum des tranches UTC de 3 h qui recouvrent la journée locale dans `CONTEXT_TZ` (défaut Europe/Paris) ; écrit seulement si toutes ces tranches sont publiées.
5. **Position** : arrondie à 2 décimales (~1 km) par le serveur, colonnes `numeric(…, 2)` ; jamais renvoyée en lecture, jamais dans un log. La météo d'un jour utilise la position de ce jour, sinon la maison.
6. **`null`** : pas encore synchronisé, archive Open-Meteo en retard, tranche Kp non publiée, ou jour hors de la table. `0` est une vraie valeur (0 mm, Kp 0, 0 min de soleil).
7. **Collecte** : tâche `context-sync` (Vercel `45 2 * * *` UTC ; node-cron 04:45 Paris) sur les 7 dernières journées complètes, plus les journées dont la position du téléphone est arrivée après coup ; `pnpm --filter api context:backfill` pour l'historique (lots d'un an).
8. **Journal** : `ingest_log` sources `weather`, `kp`, `location` (dates et nombres de jours seulement).
9. **Paramètres visuels proposés** (à trancher par le moteur v2, voir PLAN.md) : température → chaleur de la palette, pluie → texture/grain, vent → direction et force du courant, nébulosité/soleil → voile et contraste, lever/coucher → longueur du jour, Kp → aurore, lune → astre nocturne.
10. **Surveillance** : seuil de fraîcheur `weather` 72 h à ajouter dans `FRESHNESS_RULES` (voir notes de passation).

## Points d'accès et limites (vérifiés le 2026-09-25)
- Archive : `https://archive-api.open-meteo.com/v1/archive` (ERA5 depuis 1940, ~5 jours de retard ; IFS depuis 2017 sans retard). Utilisée pour les journées de plus de 14 jours.
- Prévision : `https://api.open-meteo.com/v1/forecast` avec `start_date`/`end_date` (jusqu'à 92 jours en arrière). Utilisée pour les 14 derniers jours.
- Variables `daily` (noms exacts) : `weather_code, temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max, wind_direction_10m_dominant, cloud_cover_mean, sunshine_duration, sunrise, sunset` (10 : au-delà de 10 variables, un appel compte plus). `timezone` est obligatoire dès qu'on demande du `daily`.
- Limites gratuites (usage non commercial, [conditions](https://open-meteo.com/en/terms)) : 600 appels/min, 5 000/h, 10 000/jour. Une requête longue ou avec beaucoup de variables compte pour plusieurs appels (règle de pondération non revérifiée ici : de mémoire, au-delà de 10 variables ou de 2 semaines, soit ~26 appels pour un an). Même ainsi, le backfill complet (2019 → 2026, 8 requêtes d'archive) reste très loin des limites. Pause de 1 s entre requêtes et de 2 s entre lots ; sur 429, attente de 61 s puis nouvel essai (2 au plus).
- Kp : `https://kp.gfz.de/app/json/?start=…Z&end=…Z&index=Kp` → `{ meta, datetime[], Kp[], status[] }` (`status` `def` ou `now`). Une requête par lot d'un an. Licence CC BY 4.0 (citer « GFZ Potsdam »). Pas besoin de NOAA SWPC : le GFZ couvre à la fois l'historique et le récent.
- Les hôtes Open-Meteo et GFZ n'étaient pas joignables depuis l'environnement de développement : les fixtures (`api/src/collectors/*/fixtures/`) reprennent la structure documentée des réponses, avec des valeurs plausibles. Premier appel réel à faire avec `context:sync`.

## Tables et colonnes
`daily_context(date PK, lat, lon, location_source 'phone'|'home', weather_lat, weather_lon, temp_min, temp_max, precip_mm, wind_max_kmh, wind_dir_deg, cloud_mean, sunshine_min, sunrise, sunset, weather_code, kp_max, updated_at)`.
`weather_lat/weather_lon` = position pour laquelle la météo a été calculée : si elle diffère de `lat/lon` (position du téléphone arrivée après), la tâche recalcule ce jour (60 au plus par exécution).

## Commandes
```bash
HOME_LAT=48.85 HOME_LON=2.35 DATABASE_URL=… pnpm --filter api context:backfill            # tout l'historique
pnpm --filter api context:backfill -- --from 2023-01-01 --only weather                       # reprise
pnpm --filter api context:sync                                                                # = la tâche context-sync
```
