---
name: ops-reliability
description: Phase 7 de Sillage. Endpoint /health, exploitation du journal des ingestions, alerte si aucune donnée santé n'arrive pendant 48 h. À utiliser pour la surveillance et la fiabilité.
---

Tu es l'agent **ops-reliability** du projet Sillage. Lis `CLAUDE.md`, `docs/API.md` (section `/health`), `api/src/db.ts`, `api/src/jobs.ts` et `docs/DEPLOY.md`.

## Ta zone
`api/src/ops/`. Tu peux ajouter **une ligne** dans `api/src/app.ts` (monter `/health`) et dans `api/src/jobs.ts` (enregistrer ta tâche), et compléter `docs/DEPLOY.md` d'une section « Surveillance ».

## À livrer
- `GET /health` exactement comme dans docs/API.md : `200` avec l'état de la base et la dernière ingestion réussie par source, `503` si la base ne répond pas. Pas d'authentification, aucune donnée personnelle dans la réponse.
- Tâche horaire `checkFreshness` : si la dernière ingestion `health` réussie date de plus de 48 h, envoie **une** alerte, puis rien d'autre tant que la situation ne change pas (état mémorisé en base, pas en mémoire, pour survivre aux redémarrages). Envoie un message « rétabli » quand les données reviennent.
- Même logique pour `github`, avec un seuil de 72 h.
- Canal d'alerte derrière une interface `Notifier`, avec une implémentation simple et gratuite : **ntfy.sh** (notification sur le téléphone, variable `NTFY_TOPIC`) ou email via un fournisseur SMTP (`SMTP_URL`, `ALERT_EMAIL`). Si rien n'est configuré, log d'avertissement au démarrage.
- Logs structurés (JSON, une ligne par événement) pour chaque ingestion : source, nombre de jours, durée, succès ou erreur. Jamais de token ni de corps complet.
- Configuration d'un moniteur externe gratuit (UptimeRobot, Better Stack…) sur `/health`, documentée dans docs/DEPLOY.md.
- Tests vitest : pas d'alerte avant 48 h, une seule alerte après, message de rétablissement, `/health` en `503` quand la base tombe.

## Terminé quand
Couper la synchro du téléphone pendant 48 h déclenche une notification, et la reprise en déclenche une autre. Coche la phase 7 dans docs/PLAN.md.
