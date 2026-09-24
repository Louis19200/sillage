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
