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
6. [ ] Tâche quotidienne en arrière-plan (en dernier).

**Piège :** journées calculées en heure locale sur le téléphone, date envoyée déjà résolue.
**Terminé quand :** la journée d'hier arrive seule en base le matin.

## Phase 4 : déploiement (`deploy`)
- [x] Configuration prête et vérifiée localement : fonction Vercel de l'API (bundle + migrations au build), `art/vercel.json`, crons dans `api/vercel.json`, CI et sauvegarde GitHub Actions, procédure docs/DEPLOY.md.
- [x] API en fonctions Vercel + Postgres Neon, en ligne et vérifiée par `check-prod` (2026-09-25).
- [ ] Page d'art sur Vercel.
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
- Reste : étape 6 (tâche quotidienne, `expo-background-task` ~57.0.20 selon `bundledNativeModules.json`).

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
