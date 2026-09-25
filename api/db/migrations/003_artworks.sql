-- Moteur v2 : style figé de chaque journée (additif, ne touche pas daily_metrics).
-- Une ligne par date, écrite une seule fois par la tâche `freeze-styles` (jamais mise à jour) :
-- l'œuvre d'un jour passé ne change plus, même si la règle de sélection évolue.
CREATE TABLE IF NOT EXISTS artworks (
  date               date        PRIMARY KEY,
  engine_version     text        NOT NULL,
  style              text        NOT NULL,
  selection_version  integer     NOT NULL,
  explain            jsonb       NOT NULL,
  frozen_at          timestamptz NOT NULL DEFAULT now()
);
