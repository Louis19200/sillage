# Plan de Sillage

Chaque phase se termine par quelque chose qui fonctionne. L'agent responsable de chaque phase est indiqué ; sa fiche complète est dans `.claude/agents/`.

## Phase 0 : décisions et vérifications (toi, pas un agent)
- [x] Dans Health Connect, vérifier que les **pas** et le **sommeil** de la veille apparaissent bien. C'est le seul vrai risque du projet.
- [x] Stack choisie : monorepo TypeScript `api/`, `app/`, `art/` + `packages/shared` (voir CLAUDE.md).
- [ ] Créer un token GitHub personnel **en lecture seule** (fine-grained, aucune permission de dépôt nécessaire pour `contributionsCollection` public ; ajouter « read » sur les dépôts privés si tu veux qu'ils comptent).
- [ ] Générer `INGEST_TOKEN` : `openssl rand -hex 32`.

## Phase 1 : backend (`api-backend`)
- [x] Table `daily_metrics` (migration déjà écrite) + petit exécuteur de migrations.
- [x] `POST /ingest/health`, `GET /day/:date`, `GET /range?from=&to=`.
- [x] Upsert systématique, distinction `null` / `0`.
- [x] Middleware d'auth par token.

**Terminé quand :** on peut insérer une journée avec curl et la relire.

## Phase 2 : collecteur GitHub (`github-collector`)
- [ ] Requête GraphQL `contributionsCollection` → contributions par jour.
- [ ] Script de backfill sur l'année écoulée.
- [ ] Tâche nocturne qui remet à jour les 7 derniers jours.

**Terminé quand :** la table contient un an de commits.

## Phase 3 : app Android (`android-app`)
1. [x] Projet Expo, development build, plugin Health Connect, `minSdkVersion` 26.
2. [x] Écran de permissions (lecture `Steps` et `SleepSession`).
3. [x] Écran des 7 derniers jours, sans réseau. *On valide la lecture des données ici.*
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

### Phase 1
- API livrée dans `api/` (voir `api/README.md`). `pnpm --filter api dev` démarre, la séquence curl de docs/API.md est couverte par `api/test/app.test.ts` et `api/test/postgres-driver.test.ts` (vrai driver `postgres` sur PGlite via `pglite-socket`). Pas encore rejouée contre un vrai Postgres 16 : à faire au premier `docker run`.
- `api/src/db.ts` : `upsertHealthDays`, `upsertCommits`, `getDay`, `getRange`, `logIngest` utilisables directement (base par défaut via `DATABASE_URL`) ou via `createDb(executor)` ; `setDb(db)` pour injecter PGlite dans les tests. `api/test/helpers.ts` fournit `createTestDb()` (PGlite migré).
- Enregistrer une tâche : une ligne en bas de `api/src/jobs.ts` ; une route : une ligne en bas de `createApp` dans `api/src/app.ts`.
- Ajout hors fiche : variable `PROTECT_READS` (lecture protégée par le token ; défaut `true` si `NODE_ENV=production`). À reporter dans `.env.example` et à trancher en phase 4 (`deploy`).
- `.env.example` : la valeur d'exemple d'`INGEST_TOKEN` fait 28 caractères, l'API refuse donc de démarrer tant qu'elle n'est pas remplacée (voulu).
- Les `401` ne sont pas écrits dans `ingest_log` (seuls les appels authentifiés le sont).
- Les timestamps sortent en UTC (`...Z`), ce que docs/API.md autorise.

### Phase 3
Étapes 1 à 3 faites (branche `agent/android-app`). Validées par typecheck, jest (TZ=Europe/Paris), `expo config`, `expo prebuild` (manifeste vérifié) et `expo export` (bundle Android) ; **pas encore sur un vrai téléphone** : construire le development build (voir `app/README.md`) et comparer le tableau des 7 jours avec Health Connect avant l'étape 4.
- Plugin : `react-native-health-connect` (v4 embarque le plugin Expo). `expo-health-connect` est déprécié et ne doit pas être installé en même temps (classe native en double).
- Expo SDK 57 (React Native 0.86). `expo-secure-store` et `expo-background-task` ne sont pas encore installés : à ajouter aux étapes 4 et 6 (`npx expo install`), ce qui impose de reconstruire l'APK.
- Pour la synchro (étape 4) : `computeLastCompleteDays(healthConnectReader, n)` dans `app/src/days.ts` renvoie déjà des `HealthDay` complets, conformes à `HealthIngestBody` (vérifié par les tests).
- Choix à connaître : `sleep_minutes` additionne les sessions (sieste + nuit) mais ne compte qu'une fois les recouvrements (même nuit enregistrée par le téléphone et la montre).
- Restent : étapes 4, 5, 6.
