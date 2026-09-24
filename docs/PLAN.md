# Plan de Sillage

Chaque phase se termine par quelque chose qui fonctionne. L'agent responsable de chaque phase est indiqué ; sa fiche complète est dans `.claude/agents/`.

## Phase 0 : décisions et vérifications (toi, pas un agent)
- [x] Dans Health Connect, vérifier que les **pas** et le **sommeil** de la veille apparaissent bien. C'est le seul vrai risque du projet.
- [x] Stack choisie : monorepo TypeScript `api/`, `app/`, `art/` + `packages/shared` (voir CLAUDE.md).
- [ ] Créer un token GitHub personnel **en lecture seule** (fine-grained, aucune permission de dépôt nécessaire pour `contributionsCollection` public ; ajouter « read » sur les dépôts privés si tu veux qu'ils comptent).
- [ ] Générer `INGEST_TOKEN` : `openssl rand -hex 32`.

## Phase 1 : backend (`api-backend`)
- [ ] Table `daily_metrics` (migration déjà écrite) + petit exécuteur de migrations.
- [ ] `POST /ingest/health`, `GET /day/:date`, `GET /range?from=&to=`.
- [ ] Upsert systématique, distinction `null` / `0`.
- [ ] Middleware d'auth par token.

**Terminé quand :** on peut insérer une journée avec curl et la relire.

## Phase 2 : collecteur GitHub (`github-collector`)
- [ ] Requête GraphQL `contributionsCollection` → contributions par jour.
- [ ] Script de backfill sur l'année écoulée.
- [ ] Tâche nocturne qui remet à jour les 7 derniers jours.

**Terminé quand :** la table contient un an de commits.

## Phase 3 : app Android (`android-app`)
1. [ ] Projet Expo, development build, plugin Health Connect, `minSdkVersion` 26.
2. [ ] Écran de permissions (lecture `Steps` et `SleepSession`).
3. [ ] Écran des 7 derniers jours, sans réseau. *On valide la lecture des données ici.*
4. [ ] Bouton « Synchroniser » vers l'API.
5. [ ] Bouton de backfill sur 30 jours.
6. [ ] Tâche quotidienne en arrière-plan (en dernier).

**Piège :** journées calculées en heure locale sur le téléphone, date envoyée déjà résolue.
**Terminé quand :** la journée d'hier arrive seule en base le matin.

## Phase 4 : déploiement (`deploy`)
- [ ] Backend + Postgres sur Fly.io ou Railway (choix documenté dans docs/DEPLOY.md).
- [ ] HTTPS obligatoire (Android bloque le HTTP en clair).
- [ ] Secrets en variables d'environnement, sauvegarde automatique de la base.
- [ ] Le cron GitHub tourne sur le serveur.

## Phase 5 : art génératif v1 (`generative-art`)
- [ ] Page p5.js qui lit `/day/:date` (ou les fixtures en local).
- [ ] Seed déterministe dérivée de la date : même journée, même œuvre.
- [ ] Normalisation 0–1 par rapport à **mes** moyennes.
- [ ] Mapping : sommeil → palette et luminosité, pas → mouvement et densité, commits → nombre de formes.
- [ ] Rendu prévu pour les jours incomplets.

**Terminé quand :** chaque date donne une image unique et stable.

## Phase 6 : galerie et impression (`gallery`)
- [ ] Grille par mois et par année.
- [ ] Export PNG haute définition et SVG.
- [ ] (Option) génération automatique chaque matin de l'œuvre de la veille.

## Phase 7 : fiabilisation (`ops-reliability`)
- [ ] Journal des ingestions.
- [ ] Alerte (mail ou notification) si aucune donnée santé depuis 48 h.
- [ ] Endpoint `/health`.

## Phase 8 : extensions (`extensions`)
Fréquence cardiaque, musique, lectures, météo… Chaque source = un collecteur + une colonne ou une table + un paramètre visuel.

---

## Notes de passation
<!-- Chaque agent ajoute ici, sous le nom de sa phase, ce qui reste ouvert ou ce que la suite doit savoir. -->
