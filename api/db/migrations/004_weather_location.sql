-- Phase 8 (extensions) : contexte de la journée (position, météo, indice Kp).
-- Une ligne par journée locale, upsert sur `date`. Migration additive : ne touche
-- pas `daily_metrics`. NULL = donnée absente ; jamais de DEFAULT 0.
--
-- Chaque source n'écrit que ses colonnes :
--   - POST /ingest/location (téléphone) : lat, lon, location_source = 'phone' ;
--   - collecteur météo (Open-Meteo)     : colonnes météo + weather_lat/weather_lon,
--                                         et la position « maison » (location_source = 'home')
--                                         seulement si le téléphone n'a rien envoyé pour ce jour ;
--   - collecteur Kp (GFZ Potsdam)        : kp_max.
--
-- Positions arrondies à 2 décimales (~1 km) : le type numeric(.., 2) interdit
-- de stocker plus précis, même par erreur.
CREATE TABLE IF NOT EXISTS daily_context (
  date             date          PRIMARY KEY,
  -- Position de la journée (téléphone) ou « maison » (HOME_LAT / HOME_LON).
  lat              numeric(5, 2) CHECK (lat BETWEEN -90 AND 90),
  lon              numeric(6, 2) CHECK (lon BETWEEN -180 AND 180),
  location_source  text          CHECK (location_source IN ('phone', 'home')),
  -- Position pour laquelle la météo a été calculée : si elle diffère de lat/lon
  -- (position du téléphone arrivée après coup), la tâche context-sync la recalcule.
  weather_lat      numeric(5, 2) CHECK (weather_lat BETWEEN -90 AND 90),
  weather_lon      numeric(6, 2) CHECK (weather_lon BETWEEN -180 AND 180),
  temp_min         numeric(4, 1),                                   -- °C
  temp_max         numeric(4, 1),                                   -- °C
  precip_mm        numeric(6, 1) CHECK (precip_mm >= 0),            -- mm
  wind_max_kmh     numeric(5, 1) CHECK (wind_max_kmh >= 0),         -- km/h, à 10 m
  wind_dir_deg     smallint      CHECK (wind_dir_deg BETWEEN 0 AND 360),
  cloud_mean       smallint      CHECK (cloud_mean BETWEEN 0 AND 100),  -- %
  sunshine_min     smallint      CHECK (sunshine_min BETWEEN 0 AND 1440),
  sunrise          time,                                            -- heure locale du lieu
  sunset           time,                                            -- heure locale du lieu
  weather_code     smallint      CHECK (weather_code BETWEEN 0 AND 99), -- code WMO
  kp_max           numeric(4, 3) CHECK (kp_max BETWEEN 0 AND 9),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);
