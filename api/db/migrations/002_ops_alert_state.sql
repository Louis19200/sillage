-- Phase 7 (ops-reliability) : état des alertes de fraîcheur, gardé en base
-- (les fonctions serverless ne conservent rien en mémoire d'un appel à l'autre).
-- Une ligne par contrôle (ex. 'freshness:health'). Migration additive.
CREATE TABLE IF NOT EXISTS alert_state (
  check_name       text        PRIMARY KEY,
  status           text        NOT NULL CHECK (status IN ('ok', 'stale')),
  -- Instant du dernier changement d'état (donc de la dernière notification envoyée).
  changed_at       timestamptz NOT NULL DEFAULT now(),
  -- Dernière ingestion réussie vue au dernier contrôle (NULL : aucune).
  last_success_at  timestamptz,
  checked_at       timestamptz NOT NULL DEFAULT now()
);

-- « Dernière ingestion réussie par source » (/health, contrôle de fraîcheur).
CREATE INDEX IF NOT EXISTS ingest_log_ok_source_received_idx ON ingest_log (source, received_at DESC) WHERE ok;
