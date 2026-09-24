-- Une ligne par journée locale. Upsert systématique sur `date`.
-- NULL = donnée absente ; 0 = vraiment zéro. Ne jamais utiliser DEFAULT 0.
CREATE TABLE IF NOT EXISTS daily_metrics (
  date           date        PRIMARY KEY,
  steps          integer     CHECK (steps >= 0),
  sleep_minutes  integer     CHECK (sleep_minutes >= 0),
  sleep_start    timestamptz,
  sleep_end      timestamptz,
  commits        integer     CHECK (commits >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Journal des ingestions (utilisé par la phase 7 pour l'alerte « 48 h sans données »).
CREATE TABLE IF NOT EXISTS ingest_log (
  id           bigserial   PRIMARY KEY,
  source       text        NOT NULL,          -- 'health' | 'github' | ...
  received_at  timestamptz NOT NULL DEFAULT now(),
  days_count   integer     NOT NULL,
  first_date   date,
  last_date    date,
  ok           boolean     NOT NULL,
  error        text
);
CREATE INDEX IF NOT EXISTS ingest_log_source_received_idx ON ingest_log (source, received_at DESC);
