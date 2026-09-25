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
- [x] Requête GraphQL `contributionsCollection` → contributions par jour.
- [x] Script de backfill sur l'année écoulée.
- [x] Tâche nocturne qui remet à jour les 7 derniers jours.

**Terminé quand :** la table contient un an de commits. ✅ *Backfill du 2026-09-25 : 367 journées écrites en production (2025-09-24 → 2026-09-25).*

## Phase 3 : app Android (`android-app`)
1. [x] Projet Expo, development build, plugin Health Connect, `minSdkVersion` 26.
2. [x] Écran de permissions (lecture `Steps` et `SleepSession`).
3. [x] Écran des 7 derniers jours, sans réseau. *On valide la lecture des données ici.*
4. [x] Bouton « Synchroniser » vers l'API.
5. [x] Bouton de backfill sur 30 jours.
6. [x] Tâche quotidienne en arrière-plan (en dernier). *Logique livrée et testée ; validation sur le téléphone à faire (voir notes).*

**Piège :** journées calculées en heure locale sur le téléphone, date envoyée déjà résolue.
**Terminé quand :** la journée d'hier arrive seule en base le matin.

## Phase 4 : déploiement (`deploy`)
- [x] Configuration prête et vérifiée localement : fonction Vercel de l'API (bundle + migrations au build), `art/vercel.json`, crons dans `api/vercel.json`, CI et sauvegarde GitHub Actions, procédure docs/DEPLOY.md.
- [x] API en fonctions Vercel + Postgres Neon, en ligne et vérifiée par `check-prod` (2026-09-25).
- [x] Page d'art sur Vercel, branchée sur l'API (CORS vérifié).
- [x] HTTPS obligatoire (Android bloque le HTTP en clair) : redirection HTTP → HTTPS vérifiée.
- [x] Secrets en variables d'environnement (INGEST_TOKEN, READ_TOKEN, CRON_SECRET vérifiés).
- [ ] Sauvegarde automatique de la base (workflow GitHub Actions à configurer).
- [ ] Le cron GitHub tourne via les Vercel Cron Jobs.

## Phase 5 : art génératif v1 (`generative-art`)
- [x] Page p5.js qui lit `/day/:date` (ou les fixtures en local).
- [x] Seed déterministe dérivée de la date : même journée, même œuvre.
- [x] Normalisation 0–1 par rapport à **mes** moyennes.
- [x] Mapping : sommeil → palette et luminosité, pas → mouvement et densité, commits → nombre de formes.
- [x] Rendu prévu pour les jours incomplets.

**Terminé quand :** chaque date donne une image unique et stable.

## Phase 6 : galerie et impression (`gallery`)
- [x] Grille par mois et par année.
- [x] Export PNG haute définition et SVG.
- [x] (Option) génération automatique chaque matin de l'œuvre de la veille. *(Script prêt ; planification à brancher, voir notes de phase 6.)*

## Phase 7 : fiabilisation (`ops-reliability`)
- [x] Journal des ingestions.
- [x] Alerte (mail ou notification) si aucune donnée santé depuis 48 h.
- [x] Endpoint `/health`.

## Moteur v2 : une technique par jour (`generative-art`, avec gel côté API)
- [x] Sélection déterministe partagée (`packages/shared/src/selection/`, réglages dans `constants.ts`), testée : déterminisme, pas de répétition sur 3 jours, jamais deux fois la même famille, gel, table, nulls, simulations.
- [x] Gel des styles côté API : migration `003_artworks.sql`, tâche `freeze-styles` (cron `30 3 * * *`), `style` / `style_explain` dans `GET /day` et `GET /range` (additif).
- [x] Cadre du moteur v2 côté art (`art/src/engine-v2/`) : interface `Technique`, palettes v2, rendu en Worker, fiche de calcul, galerie et export.
- [x] Techniques portées : Marée (v1), Attracteur.
- [ ] Techniques à porter (rendu provisoire en attendant) : Pelage, Corail, Harmonographe, Vitrail, Constructif, Réseau, Hachures, Pixels.
- [ ] Déploiement : migration 003 + premier gel en production (voir notes).

**Terminé quand :** chaque jour de l'historique a un style figé, la page du jour montre sa technique et la fiche « Comment cette œuvre a été choisie ».

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

### Phase 1 (suite)
Préparation du déploiement Vercel + Neon (branche `agent/api-backend-vercel`), couverte par `api/test/vercel.test.ts`.
- Nouvelles variables (voir `.env.example`, docs/API.md) : `READ_TOKEN` (lecture seule, ≥ 32 car., ≠ `INGEST_TOKEN`), `CRON_SECRET` (≥ 16 car.), `CORS_ORIGINS` (origines complètes, sans joker), `DATABASE_SERVERLESS`.
- **Pour `deploy`** : le point d'entrée Vercel fait `createApp(depsFromEnv(loadEnv(), getDb()))` (`depsFromEnv` dans `api/src/app.ts`) ; `getDb()` et `pnpm --filter api migrate` appliquent `DATABASE_SERVERLESS` (pour les migrations via le pooler, `.simple()` est déjà utilisé ; l'URL directe non poolée convient aussi). Si Hono est monté sous un préfixe (`/api`), les chemins de `vercel.json` (`crons[].path`) doivent le reprendre.
- **Pour `github-collector`** : `GET /cron/github-sync` exécute la tâche du registre et renvoie sa valeur de retour dans `result` ; `500` si elle lève. `hasJob(name)` et `invokeJob(name)` (erreur propagée, `UnknownJobError`) sont exportés par `api/src/jobs.ts`.
- **Pour `generative-art`** : `VITE_API_TOKEN` = `READ_TOKEN`, et l'origine de la page dans `CORS_ORIGINS`.
- Une page d'art sur une URL de prévisualisation Vercel (hôte variable) ne passera pas le CORS : ajouter l'origine explicitement si besoin.
- Pas testé contre un vrai Neon : les options serverless sont vérifiées sur l'objet client, pas sur le pooler.

### Phase 2
Collecteur livré dans `api/src/collectors/github/` (voir la section « Collecteur GitHub » d'`api/README.md`). Testé uniquement avec un `fetch` simulé (fixture `fixtures/contributions-7-days.json`, structure réelle de `contributionCalendar`) ; un appel réel avec un faux token renvoie bien le `401` attendu, journalisé dans `ingest_log`.
- **Reste à faire (toi)** : créer le token fine-grained en lecture seule, renseigner `GITHUB_TOKEN` et `GITHUB_LOGIN`, puis `DATABASE_URL=<Neon> pnpm --filter api github:backfill`. Vérifier ensuite quelques journées contre le calendrier du profil GitHub, et cocher « Terminé quand ».
- Tâche `github-sync` enregistrée dans `api/src/jobs.ts` (04:15 Europe/Paris, import dynamique) ; elle **renvoie** un résumé JSON `{ source, from, to, days_written, first_date, last_date }`. `runJob` actuel ignore ce retour : la route `GET /cron/:name` (api-backend) doit appeler la fonction de la tâche et renvoyer son résultat. Une seule requête GraphQL, aucun état en mémoire. Pour Vercel Cron (deploy) : les horaires sont en UTC, 04:15 Paris = `15 2 * * *` l'été, `15 3 * * *` l'hiver.
- Variables à déclarer sur Vercel : `GITHUB_TOKEN`, `GITHUB_LOGIN` (déjà dans `.env.example`).
- Choix à connaître : `commits` = `contributionCount` (commits + PR + issues + revues) en v1 ; dates dans le fuseau du **profil GitHub**, non recalculées. Pour ne jamais écrire une journée coupée par une borne de requête, chaque requête démarre 48 h plus tôt et sa première journée est écartée : « 7 jours » écrit 9 journées, « 365 jours » en écrit 367.
- Hors zone (minime) : `api/test/env-jobs.test.ts` vide maintenant le registre avant chaque test (`beforeEach(clearJobs)`), car jobs.ts enregistre désormais une tâche au chargement.

### Phase 3
Étapes 1 à 3 faites (branche `agent/android-app`). Validées par typecheck, jest (TZ=Europe/Paris), `expo config`, `expo prebuild` (manifeste vérifié) et `expo export` (bundle Android) ; **pas encore sur un vrai téléphone** : construire le development build (voir `app/README.md`) et comparer le tableau des 7 jours avec Health Connect avant l'étape 4.
- Plugin : `react-native-health-connect` (v4 embarque le plugin Expo). `expo-health-connect` est déprécié et ne doit pas être installé en même temps (classe native en double).
- Expo SDK 57 (React Native 0.86). `expo-secure-store` est installé depuis l'étape 4 ; `expo-background-task` reste à ajouter à l'étape 6, ce qui impose de reconstruire l'APK.
- Pour la synchro (étape 4) : `computeLastCompleteDays(healthConnectReader, n)` dans `app/src/days.ts` renvoie déjà des `HealthDay` complets, conformes à `HealthIngestBody` (vérifié par les tests).
- Choix à connaître : `sleep_minutes` additionne les sessions (sieste + nuit) mais ne compte qu'une fois les recouvrements (même nuit enregistrée par le téléphone et la montre).

Étapes 4 et 5 faites. Réglages (URL + `INGEST_TOKEN` dans `expo-secure-store` ~57.0.4, plugin ajouté à `app.json`) et panneau de synchro sous le tableau : « Synchroniser (7 jours) » et « Backfill 30 jours », chacun en **un seul** `POST /ingest/health`.
- Client dans `app/src/api.ts` (`fetch` injecté, délai 20 s, réponse validée par `IngestResult`, 400 avec les `issues` de l'API, 401, réseau, délai ; token jamais loggué, masqué même si le serveur le renvoie). Orchestration dans `app/src/sync.ts` (`runSync(kind, deps)`), testée avec jest.
- Validé contre la vraie API locale (PGlite + `pnpm --filter @sillage/api start`) par `pnpm --filter @sillage/app check-api` : 30 jours envoyés, `{"upserted":30}`, relus identiques via `GET /day`, faux token → 401, API arrêtée → erreur réseau. **Pas encore sur le téléphone** : il faut reconstruire le development build (nouveau module natif), voir `app/README.md`.
- Mémorisé dans SecureStore (`sillage.syncState`) : dernière tentative et dernière réussite (`SyncRecord` : instant, type, période, `upserted` ou erreur). L'étape 6 peut réutiliser `runSync` en ajoutant un type (3 jours) à `SyncKind`/`daysFor`, et le même état ; `SYNC_DAYS`/`BACKFILL_DAYS` sont dans `sync.ts`.
- Le development build autorise le HTTP en clair (`usesCleartextTraffic` en debug) : `http://localhost:8787` via `adb reverse` fonctionne ; un APK de production exigera l'URL HTTPS de Vercel.

Étape 6 faite côté code (`expo-background-task` et `expo-task-manager` ~57.0.20). **Pas encore validée sur le téléphone** : « Terminé quand » reste à constater (hier en base le matin, sans ouvrir l'app). Procédure pour l'utilisateur : section « Synchro automatique » d'`app/README.md`.
- Tâche `sillage-daily-sync` (définie dans `app/src/backgroundTask.ts`, importé par `index.ts` avant `registerRootComponent`), réveil WorkManager toutes les 3 h environ, réseau requis, jamais app à l'écran. Elle n'envoie qu'une fois par jour, au premier réveil après 5 h locale, les 3 dernières journées complètes (`SyncKind` `background`, via `runSync`, donc mêmes règles : valeurs présentes seulement, rien si Health Connect ne renvoie rien). Décisions pures dans `app/src/background.ts` (`needsDailySync`, `shouldSyncOnOpen`, `describeAutoSync`, `runBackgroundTask` qui ne lève jamais), testées avec jest, changements d'heure compris.
- Repli honnête : à l'ouverture de l'app (et au retour au premier plan), si hier n'a pas été envoyé, synchro de 3 jours (`SyncKind` `open`), jamais sans URL/token, au plus une tentative ratée par 30 min. Le panneau dit si la synchro automatique est « activée, en arrière-plan » ou « à l'ouverture seulement » et pourquoi.
- **Lecture en arrière-plan sur Android 12 (Health Connect du Play Store)** : il faut la permission `READ_HEALTH_DATA_IN_BACKGROUND` (déclarée dans `app.json`, demandée par le bouton « Autoriser la lecture en arrière-plan »). La fonctionnalité existe sur Android 13 et moins depuis connect-client 1.1.0-alpha11, si l'APK Health Connect a le versionCode ≥ 171302 (table `FEATURE_TO_VERSION_INFO_MAP` d'androidx) ; react-native-health-connect 4.1.3 sait demander la permission (`BackgroundAccessPermission`) mais n'expose pas `getFeatureStatus`, d'où le module local `app/modules/sillage-device` (Kotlin, connect-client 1.1.0, lecture seule, + optimisation/restriction de batterie). Sans la permission, une lecture en arrière-plan ne renvoie que les données de l'app elle-même (donc vide) ou lève une SecurityException : les deux cas sont gérés (rien envoyé, échec expliqué, repli à l'ouverture).
- **Non vérifié** : compilation Gradle du module `sillage-device` (pas de SDK Android ni d'accès à maven.google.com ici ; compilé seulement contre des stubs avec kotlinc 2.0.21, autolinking vérifié par `expo-modules-autolinking resolve`). Si le build EAS échoue sur ce module, supprimer `app/modules/sillage-device` suffit : le JS le traite comme absent (« inconnu »). Manifeste final (services WorkManager `SystemJobService`, `RescheduleReceiver`, `TaskJobService`) non inspecté : il vient des bibliothèques à la fusion Gradle ; `expo prebuild` montre bien la permission `READ_HEALTH_DATA_IN_BACKGROUND`.
- État mémorisé : `SyncState.lastBackground` (dernier réveil : `sent`/`failed`/`skipped`), relu comme `null` depuis un état antérieur. `readSyncState` (lève) pour les synchros, `loadSyncState` (ne lève pas) pour l'affichage : une lecture ratée du stockage n'écrase jamais l'état.

### Phase 4
Config livrée, **mise en ligne à faire par toi** en suivant [docs/DEPLOY.md](DEPLOY.md) (liste « Tout refaire depuis zéro » à la fin). Les cases ci-dessus se cochent quand `curl https://<api>.vercel.app/range?…` répond avec le token et que le téléphone a synchronisé.
- **Forme de la fonction** : ni `api/api/[[...route]].ts` ni le mode « zéro config » Hono. Le builder Node de Vercel transpile fichier par fichier sans regrouper ; l'API importe sans extension (`./db`) en ESM et `@sillage/shared` est en TypeScript, donc la fonction plantait au chargement (`Cannot find module …/src/app`, constaté avec `vercel build` 60.0.0). `api/api/_build.mjs` regroupe tout avec esbuild et écrit la sortie Build Output API v3 ; `vercel build --prod` hors ligne l'accepte et y ajoute les crons de `vercel.json`.
- **Vérifié sans compte** : `pnpm --filter @sillage/api vercel:check` (build avec migrations sur PGlite, puis POST/GET/401/404 contre le fichier déployé) ; même essai à la main contre un vrai Postgres 16 (migrations par `DATABASE_URL_UNPOOLED`, échec de migration → build en échec) ; `vercel build --prod` des deux projets ; `actionlint` sur les deux workflows ; sauvegarde → chiffrement → restauration testée sur Postgres 16. **Non vérifié** : le routage réel de Vercel (d'où le paramètre `__path` de secours), le workflow de sauvegarde sur un runner GitHub, Neon lui-même.
- **Dépend de api-backend** (en cours) : `GET /cron/:name`, `READ_TOKEN`, `CORS_ORIGINS`, `DATABASE_SERVERLESS`. `api/api/_app.ts` construit l'app exactement comme `src/server.ts` aujourd'hui (`createApp({ db, ingestToken, protectReads })`). **Si api-backend ajoute des dépendances à `createApp`** (jetons de lecture, secret cron, origines CORS…) au lieu de les lire dans l'environnement, reporter le même appel dans `buildFromEnv()` de `api/api/_app.ts` ; `vercel:check` le signalera par le typecheck.
- **Dépend de github-collector** : tâche `github-sync` dans `jobs.ts` et script `github:backfill` (cités dans DEPLOY.md).
- Hors zone, minimal : `esbuild` en devDependency et script `vercel:check` dans `api/package.json` ; `.vercel/` dans `.gitignore`.
- **Test instable (generative-art)** : `art/src/engine/compose.test.ts` « deux dates différentes des fixtures… » dépasse ses 5 s quand `pnpm -r test` fait tourner les paquets en parallèle sur une machine chargée ; il passe seul. La CI utilise `--workspace-concurrency=1` ; à corriger côté art (délai du test ou fixtures plus légères).
- Pas de variables deploy dans `.env.example` (`CRON_SECRET`, `DATABASE_URL_UNPOOLED`, `SILLAGE_MIGRATE`) : elles n'existent que sur Vercel, voir DEPLOY.md.

### Phase 5
Œuvre « Sillage » : un courant de lignes (les sillages) traverse le cadre, dévié par des pierres, sous un astre. Aperçus : `art/docs/previews/`. Lancer : `pnpm --filter art dev` puis `?date=YYYY-MM-DD` (flèches ← → pour naviguer).

**Mapping final** (tout est dans `art/src/engine/mapping.ts`) :
- **Sommeil → palette et luminosité.** Sommeil normalisé < 0,5 (sous mon habitude) : œuvre **nocturne** (bleu nuit → heure bleue, encre claire, lune crème). ≥ 0,5 : œuvre **diurne** (ciel pâle → lumière dorée, encre sombre, soleil). Interpolation continue en OKLCH dans chaque famille, décalage de teinte seedé ±12°. Taille de l'astre ∝ sommeil normalisé ; hauteur de l'astre = heure du réveil (`sleep_end`, 5 h 30 → bas, 10 h 30 → haut).
- **Pas → mouvement et densité.** Nombre de sillages 26 → 120 et amplitude des remous 0,12 → 0,8 (rotationnel d'un bruit de Perlin seedé, donc sans agglutinement), fréquence des remous plus serrée et traits plus fins quand on a beaucoup marché.
- **Commits → nombre de formes.** Une pierre par commit (plafond 40), regroupées en 1 à 3 archipels ; taille selon le commit normalisé ; le courant les contourne (écoulement potentiel autour de cylindres) ; reflet tourné vers l'astre.
- **Données manquantes** (jamais confondues avec 0) : sommeil `null` → palette de **brume** grise et astre en **pointillés** ; pas `null` → sillages **en pointillés** gris ; pas `0` → **eau dormante** (lignes horizontales continues) ; commits `null` → 3 **pierres fantômes** en pointillés ; commits `0` → aucune pierre. Jour absent de la base = tout `null`.
- **Normalisation** : rang percentile sur les valeurs non `null` des 90 jours **avant** J (J exclu) ; sous 14 points, sigmoïde autour des défauts (8 000 pas, 7 h 30, 4 commits), voir `DEFAULTS` dans `normalize.ts`.

**Pour la galerie (phase 6)** : importer depuis `art/src/engine` (`composeForDate`, `composeDay`, `normalizeDay`, `seedFromDate`, types `Scene`…) et `art/src/engine/render-p5` (`mountScene`, `drawScene`, `drawSceneToContext` pour un PNG sans p5). La `Scene` est du JSON pur en 1000 × 1000 (dégradés linéaires/radiaux, cercles, courbes Catmull-Rom, polygones, pointillés via `dash`) : l'export SVG n'a qu'à la traduire, `catmullRomToBezier` donne les segments `C`. Compter ~25 ms par scène en Node.

**Reste ouvert** :
- La page lit `GET /range` (J-90 → J) plutôt que `/day/:date` (un seul appel suffit à J et à sa référence) ; `getDay` existe dans la source `api` pour la galerie.
- Mode `api` validé contre un faux serveur seulement : l'API réelle devra autoriser l'origine de la page (CORS) pour `GET /range` avec l'en-tête `Authorization`. `VITE_API_TOKEN` finit dans le bundle client : n'y mettre qu'un jeton de **lecture**.
- `index.html` à la racine de `art/` est la page du jour ; la galerie pourra en faire une entrée Vite parmi d'autres.

### Phase 6
Galerie `/gallery/?year=YYYY` et `/gallery/?month=YYYY-MM`, exports PNG/SVG sur la page du jour. Détails et commandes : section « Galerie et exports » d'`art/README.md`. Aperçus : `art/docs/previews/gallery-*.jpg`, `export-svg-2026-07-14.png`, `day-export-2026-07-14.png`.
- **Navigation** : page du jour → « galerie » (mois de la date) ; case d'une miniature → page du jour, qui porte « Exporter PNG [2000 | 4000 | 8000 px] · SVG ». Vue année : sélecteur 2019 → année courante (`VITE_GALLERY_FIRST_YEAR`), une année vide affiche « Aucune journée enregistrée » sur une grille de points. Une seule requête `/range` par vue (période + 90 jours avant).
- **Jour « sans données »** = absent de la base ou les trois métriques à `null` : un point (vue année), un carré en pointillés « sans données » (vue mois). Il reste cliquable (la page du jour rend la brume).
- **Performance mesurée** (Chromium headless, conteneur 4 vCPU, build de production, faux serveur `/range` de 7 ans, 363 jours avec données en 2024) : 1ʳᵉ miniature en 60–100 ms, les 363 en **2,4–2,5 s à froid** avec 3 workers (composition ~19 ms par scène dans un worker, ~2,7 ms par miniature sur le fil principal, plus longue tranche 13–19 ms : pas de gel), **70–80 ms au second passage** (cache IndexedDB, 363/363). Mois : 31 œuvres en ~0,5 s à froid, ~10 ms en cache. Le débit à froid est borné par le nombre de cœurs : 363 × 19 ms / nombre de workers, soit ~1,2 s attendu sur un portable 8 threads (6 workers). La seule tâche longue restante est l'évaluation du bundle p5 (~130 ms) au chargement.
- **SVG = PNG** : même `Scene`, `sceneToSvg` traduit `drawSceneToContext` primitive par primitive. Vérifié dans Chromium à 4000 px puis réduits à 1000 : écart moyen 0,2/255, max 13/255 (2026-07-14) ; 0,04/255 (2026-06-06). Le PNG Node (resvg) vs le PNG navigateur : écart moyen 1,1/255. Le SVG exporté par le navigateur est identique octet pour octet à l'instantané Node (`src/export/__snapshots__/`). 250 Ko pour une journée chargée (chemins relatifs au centième), PNG 4000 px ~11 Mo en ~0,7 s, bloc `pHYs` à 300 dpi (33,9 cm).
- **Génération de la veille** : `pnpm --filter @sillage/art render:yesterday` (tsx + `@resvg/resvg-js`, sans navigateur) écrit `art/exports/YYYY-MM-DD.{svg,png}` ; sortie 3 si la journée n'a pas encore de données. Pas branché : Vercel Cron n'a pas de disque durable, un workflow GitHub Actions planifié est proposé dans `art/README.md` (**à ajouter par `deploy`**, avec les secrets `SILLAGE_API_URL` et `SILLAGE_READ_TOKEN` = `READ_TOKEN`). Où garder les images (artefact 90 jours, branche, Vercel Blob) reste à décider.
- **Hors zone, minimal** : `art/gallery/index.html` (entrée) et `build.rollupOptions.input` dans `art/vite.config.ts` ; `art/index.html` (ligne export + lien galerie, feuille `src/export/export.css`) et trois lignes dans `src/pages/day/main.ts` (`mountExportControls`, lien galerie, `innerHeight - 230` au lieu de 200 pour garder l'œuvre dans l'écran) ; `scripts` dans `art/tsconfig.json` ; `@resvg/resvg-js` et `tsx` en devDependencies d'art ; trois variables documentées dans `.env.example`.
- **Vercel** : aucun changement de `art/vercel.json`. `vercel build --prod` (CLI 60.0.1, hors ligne) sort `static/gallery/index.html`, servi tel quel à `/gallery/` ; le worker est un fichier de `assets/` de même origine. **Redéployer** le projet `art` suffit.
- **Piège de build** : un `import "./x.css"` dans un module partagé par les deux entrées rend `vite build` ~100× plus lent (106 s, `vite:css-post` sur le chunk p5 de 1,1 Mo). Les feuilles passent donc par des `<link>` dans le HTML.
- **Pour `generative-art`** : (1) `drawSceneToContext` vit dans `render-p5.ts`, qui importe p5 au chargement ; p5 plante dans un worker (`window is not defined`), donc les miniatures sont dessinées sur le fil principal. Un `render-canvas.ts` sans p5 (le même code, `render-p5` le réexportant) permettrait de dessiner dans les workers (`OffscreenCanvas`) et de sortir p5 du bundle de la galerie. (2) Avec l'historique réel, **2019 → avril 2023 n'ont pas de sommeil** : toutes ces œuvres sont en palette de brume grise (voir `gallery-year-2019-incomplete.jpg`) ; c'est fidèle au mapping, mais quatre ans de gris méritent peut-être une palette « sommeil inconnu » moins uniforme. (3) La composition (~19 ms en navigateur) domine le coût à froid ; un mode « aperçu » (moins de sillages pour une miniature de 64 px) diviserait le temps d'une vue année.

### Phase 7
Livré dans `api/src/ops/` (tests : `api/src/ops/ops.test.ts`, 19 tests PGlite ; `vercel:check` rejoue `/health` et `/cron/check-freshness` sur le bundle avec le vrai driver). Mode d'emploi : docs/DEPLOY.md, section 12 « Surveillance ».
- **`GET /health`** : public (même avec `PROTECT_READS=true`, testé), `Cache-Control: no-store`, répond aussi à `HEAD`. `200 {status, db, last_ingest: {health, github}}` (dernière ingestion **réussie**, ISO), `503 {status:"error", db:"error", last_ingest: {…null}}` si la base échoue ou ne répond pas en 8 s. Le corps du 503 n'était pas précisé dans docs/API.md (non modifié).
- **`check-freshness`** (jobs.ts ; Vercel `5 7 * * *` UTC, node-cron local `5 * * * *`) : seuils `health` 48 h, `github` 72 h (`FRESHNESS_RULES` dans `api/src/ops/freshness.ts`). Une alerte au passage « à jour → en retard », un « rétabli » au retour, rien entre les deux. État dans `alert_state` (migration additive `002_ops_alert_state.sql`, plus un index partiel `ingest_log … WHERE ok`) ; transition « réservée » par un UPDATE conditionnel, donc une double livraison du cron n'envoie qu'une alerte ; envoi en échec → état inchangé, tâche en 500, nouvel essai au contrôle suivant. Contrôle quotidien : l'alerte santé part entre 48 h et 72 h après la dernière synchro réussie.
- **Notifier** : interface `Notifier` (`api/src/ops/notifier.ts`) ; `NtfyNotifier` (publication JSON, `NTFY_TOPIC`, `NTFY_SERVER`, `NTFY_TOKEN`, et `ALERT_EMAIL` transmis à ntfy qui fait suivre par e-mail) ; `LogNotifier` en repli, avec un avertissement `notifier_missing` au démarrage de chaque instance. Pas de SMTP (pas de dépendance) : l'e-mail passe par ntfy.
- **Journaux structurés** : middlewares sur `/ingest/*` et `/cron/*` uniquement (jamais `*`), montés par **une** ligne au début de `createApp` (`mountOps(app, deps)`, avant les routes, car Hono exécute les middlewares dans l'ordre d'enregistrement) + son import. Événements `ingest`, `job`, `freshness`, `health`, `alert`. Les chaînes passent par `sanitize` (Bearer, tokens GitHub, hex ≥ 32 masqués, 300 caractères max). Les ingestions lancées hors HTTP (node-cron local, scripts de backfill) n'ont que leur ligne `ingest_log`, pas de ligne JSON.
- Hors zone, autorisé : `api/vercel.json` (cron), `api/api/_smoke.ts` (migration 002, `/health` public, `/cron/check-freshness`), `api/scripts/check-prod.mjs` (`/health` + âge des dernières ingestions), `.env.example` (variables ntfy). **Hors zone, inévitable** : `test/db.test.ts` et `test/postgres-driver.test.ts` listaient les migrations en dur, `002_ops_alert_state.sql` y est ajoutée.
- **Reste à faire (toi)** : app ntfy + `NTFY_TOPIC` sur Vercel puis Redeploy (DEPLOY.md 12.2), test de bout en bout (12.3), moniteur UptimeRobot à 30 min sur `/health` (12.4). « Terminé quand » (48 h sans synchro → notification, reprise → notification) n'est vérifié qu'en tests : à constater en production.
- Pour `android-app` (étape 6) : la tâche quotidienne en arrière-plan rend le seuil de 48 h pertinent ; tant qu'elle n'existe pas, deux jours sans ouvrir l'app déclenchent l'alerte (voulu : c'est le rappel).

### Import Samsung Health (hors phases)
Health Connect ne reçoit les données de Samsung Health qu'à partir de leur connexion (constaté sur Galaxy Note 10+, Android 12). Historique récupéré par l'export « Télécharger mes données personnelles » : `pnpm --filter api samsung:import <dossier> [--send]` (voir api/README.md). Export de l'utilisateur : 2446 journées de pas (2019-07-05 → 2026-09-24), 492 nuits. **Importé en production le 2026-09-25 (2446 journées).**

### Moteur v2
Branche `worktree-agent-ac153f2dc745eadf0` (partie des esquisses `a26d304`). Mode d'emploi : section « Moteur v2 » d'`art/README.md`.
- **Contrat (additif)** : `DailyMetrics` gagne `style?` (`StyleIdSchema`, 10 valeurs) et `style_explain?` (`StyleExplain` : `SelectionExplain` + `frozen_at`, `engine_version`), dans `packages/shared/src/index.ts`, documentés dans docs/API.md, testés. `@sillage/shared` exporte aussi toute la sélection (`computeChain`, `selectDay`, `STYLES`, `FAMILIES`…). Les tests de `packages/shared` tournent maintenant avec `tsx --test` (imports sans extension, pour que l'app Expo continue de compiler).
- **Sélection** : règles validées, toutes les valeurs dans `packages/shared/src/selection/constants.ts` (`SELECTION_VERSION = 1`). Choix à connaître : minute du réveil lue telle quelle si `sleep_end` a un décalage explicite, convertie en Europe/Paris si elle arrive en UTC (« …Z », ce que renvoie l'API) : fixtures et API donnent le même K. Jour « sans données » = pas, sommeil, réveil et commits tous absents (la météo seule ne compte pas) → K = numéro du jour depuis l'origine (0 le premier jour). Seuils météo proposés (à valider) : pluie ≥ 1 mm, vent fort ≥ 40 km/h ; règles actives dès que les champs `temp_max`, `precip_mm`, `wind_max_kmh` existent sur la journée (sans effet sur les jours déjà figés).
- **Pour l'agent météo** : la sélection et `art/src/engine-v2/input.ts` lisent `temp_max`, `precip_mm`, `wind_max_kmh` (et côté art `temp_min`, `wind_dir_deg`, `cloud_cover`, `hourly_steps`) s'ils sont présents sur les jours de `GET /range`. Si les noms diffèrent, adapter `toSelectionDay` (`api/src/artworks/index.ts` et `art/src/engine-v2/select.ts`) et `weatherOf` (`input.ts`). Toute nouvelle donnée ne change que les jours non figés.
- **Simulation** : fixtures (120 j) : Marée 9,2 %, Attracteur 12,5 %, Pelage 6,7 %, Corail 11,7 %, Harmonographe 15,8 %, Vitrail 10,8 %, Constructif 6,7 %, Réseau 10,8 %, Hachures 8,3 %, Pixels 7,5 %. 7 ans synthétiques avec trous (2 639 j, 94 ms) : de 5,0 % (Pixels) à 13,5 % (Harmonographe). Relancer sur les vraies données : `pnpm --filter @sillage/art v2:styles -- range.json`.
- **API** (autorisé pour ces ajouts) : `api/db/migrations/003_artworks.sql`, `api/src/artworks/` (gel + `attachStyles`, 10 tests PGlite), une ligne dans `jobs.ts`, `withStyles` sur `/day` et `/range` dans `app.ts` (une panne d'`artworks` ne casse pas la lecture), cron `30 3 * * *` dans `api/vercel.json`. Hors zone, inévitable : liste des migrations dans `test/db.test.ts` et `test/postgres-driver.test.ts` (**l'agent de la migration 004 devra y ajouter la sienne**), deux vérifications dans `api/api/_smoke.ts` (migration 003, `/cron/freeze-styles` → ~2 460 jours figés en 0,3 s avec le vrai driver). Limite connue : `github-sync` réécrit les 7 derniers jours, le gel prend les jours de 3 jours et plus ; un commit compté tardivement (jours 3 à 7) ne change plus le style.
- **Art** : `drawSceneToContext` déplacé tel quel dans `engine/render-canvas.ts` (sans p5, `render-p5` le réexporte) ; `export/png.ts` et `pages/gallery/thumbs.ts` l'importent de là, donc la galerie et la page v2 ne chargent plus p5 (chunk v1 seul). Page du jour découpée en `main.ts` (choix du moteur, import à la demande), `v1.ts` (inchangé), `v2.ts`. Galerie : mode v2 (miniatures rendues par les Workers en WebP, liseré de famille, compteurs par technique, infobulle = fiche compacte). `DataSource.firstDate?()` (fixtures) pour que la chaîne parte de l'origine sans style figé.
- **Mesures** (Chromium headless, fixtures) : page du jour Attracteur ~0,5–0,7 s de rendu hors fil principal, Marée ~0,1 s ; galerie mois 31 œuvres en 0,4 s, année 120 œuvres en 0,5–0,7 s. Attracteur : détection des formes effondrées (orbite périodique → `a` décalé de ±0,071, expliqué dans la fiche).
- **Captures** : `art/docs/previews/v2/` (page du jour avec fiche dépliée pour Attracteur, Marée et un rendu provisoire, mobile, galerie mois et année). `capture:v2` vérifie aussi que chaque technique donne la même image d'un rendu et d'un chargement à l'autre.
- **Reste à faire (toi)** : redéployer l'API (la migration 003 s'applique au build), puis lancer le premier gel sans attendre le cron : `curl https://<api>/cron/freeze-styles -H "Authorization: Bearer $CRON_SECRET"` (fige 2019 → aujourd'hui − 3, ~2 600 jours) ; vérifier `GET /day/<date>` → `style`. Redéployer `art`. Optionnel : `VITE_SELECTION_ORIGIN` (premier jour de l'historique) n'est utile qu'avant le premier gel.
- **Reste à faire (agents)** : porter les 8 techniques (gabarit `art/src/engine-v2/techniques/_template.ts`, doc « Ajouter une technique ») ; Pelage et Réseau tournent déjà dans un Worker, prévoir `quality: "preview"` pour les vues année.
